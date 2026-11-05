// End-to-end check in headless Chrome: screenshots of every screen, the Q7 and thank-you rules,
// the idle and thank-you resets, and the offline queue.
// Usage: node check.mjs [page-url] [screenshot-dir]
// By default formResponse is intercepted and answered locally. LIVE=1 lets the offline-queue
// submission through to the real Google Form (one row in the Sheet).
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const PAGE = process.argv[2] || new URL('index.html', import.meta.url).href;
const OUT = process.argv[3];
const LIVE = process.env.LIVE === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'ws-kiosk-check-'));
const chrome = spawn('google-chrome', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) resolve(m[0]); });
  chrome.on('exit', () => reject(new Error('Chrome exited: ' + buf)));
});

let ws, seq = 0;
const pending = new Map(), listeners = [];
function connect(url) {
  ws = new WebSocket(url);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method) listeners.forEach((l) => l(m));
  };
  return new Promise((r) => (ws.onopen = r));
}
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

let sid;
const page = (method, params) => send(method, params, sid);
async function js(expression) {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(expression + ': ' + r.exceptionDetails.exception?.description);
  return r.result.value;
}
async function go(url) {
  await page('Page.navigate', { url });
  for (let i = 0; i < 50 && (await js('document.readyState').catch(() => '')) !== 'complete'; i++) await sleep(100);
  await sleep(300);
}
async function shot(name) {
  if (!OUT) return;
  await sleep(350);
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64'));
}
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const tap = (label) => js(`[...document.querySelectorAll('.opt')].find(b => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
const visible = () => js(`['welcome','question','details','thanks'].find(id => !document.getElementById(id).hidden)`);
const fill = (sel, v) => js(`document.querySelector(${JSON.stringify(sel)}).value = ${JSON.stringify(v)}`);

let posts = 0, offline = false;
try {
  await connect(wsUrl);
  ({ sessionId: sid } = await send('Target.attachToTarget', {
    targetId: (await send('Target.createTarget', { url: 'about:blank' })).targetId, flatten: true }));
  await page('Page.enable');
  await page('Network.enable');
  listeners.push((m) => {
    if (m.method === 'Fetch.requestPaused') offline
      ? page('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'InternetDisconnected' })
      : page('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, body: '' });
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('formResponse')) posts++;
  });
  // The screenshot run never reaches the real form.
  await page('Fetch.enable', { patterns: [{ urlPattern: '*formResponse*' }] });
  if (OUT) mkdirSync(OUT, { recursive: true });

  // Screenshots of every screen, landscape then portrait.
  for (const [p, w, h] of [['L', 1280, 800], ['P', 800, 1280]]) {
    await page('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true,
      screenOrientation: { type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0 } });
    await go(PAGE);
    await shot(`${p}-01-welcome`);
    await click('#start');
    await tap('Agency'); await tap('Government'); await shot(`${p}-02-q1-type-max2`);
    await click('#next'); await shot(`${p}-03-q2-role`);
    await tap('Director'); await sleep(400);
    await tap('Our own brand'); await shot(`${p}-04-q3-for-whom`);
    await click('#next'); await tap('Portugal'); await tap('Greece'); await shot(`${p}-05-q4-markets`);
    await click('#next'); await tap('Finding'); await tap('Seeing'); await tap('Tracking'); await shot(`${p}-06-q5-help-max3`);
    await click('#next'); await shot(`${p}-07-q6-today`);
    await tap('Another platform'); await sleep(400);
    await fill('#q-text', 'Modash'); await js(`document.querySelector('#q-text').dispatchEvent(new Event('input'))`);
    await shot(`${p}-08-q6b-which-platform`);
    await click('#next'); await shot(`${p}-09-q7-volume-gov`);
    await tap('4 to 10'); await sleep(400); await shot(`${p}-10-q8-when`);
    await tap('In the next'); await sleep(400); await shot(`${p}-11-details`);
    await fill('#f-name', 'Inês'); await fill('#f-email', 'ines@'); await click('#details button[type=submit]');
    await shot(`${p}-12-details-errors`);
    await fill('#f-name', 'Inês Carvalho'); await fill('#f-company', 'Lisboa Câmara Comunicação');
    await fill('#f-email', 'ines.carvalho@example.pt'); await fill('#f-phone', '+351 912 847 193');
    await js(`document.querySelector('#f-consent').checked = true`); await js(`document.querySelectorAll('.bad').forEach(e => e.classList.remove('bad'))`);
    await js(`document.querySelectorAll('.err').forEach(e => e.textContent = '')`);
    await shot(`${p}-13-details-filled`);
    await click('#details button[type=submit]'); await shot(`${p}-14-thank-you`);
  }
  await js(`localStorage.clear()`);

  // The Q7 wording and the thank-you line, rule by rule.
  const rules = await js(`(() => {
    const own = ['Our own brand or work (your content, your campaigns)'], clients = ['Our clients (campaigns and content you run for others)'];
    const resell = ['To resell or build into our offer (as a partner, reseller or integration)'];
    const gov = ['Government or public body (communications offices and public organisations)'], agency = ['Agency (creative, social, media or influencer)'];
    const creator = ['Creator (you make the content yourself)'];
    return {
      vClients: volumeKey({ type: gov, use: clients }), vResell: volumeKey({ type: agency, use: resell }),
      vGov: volumeKey({ type: gov, use: own }), vOther: volumeKey({ type: agency, use: own }),
      tCreator: thanksLine({ type: creator, use: own, help: [] }),
      tCreatorAgency: thanksLine({ type: [...agency, ...creator], use: own, help: [] }),
      tPartner: thanksLine({ type: agency, use: own, help: ['Social data in our own tools (through API or MCP)'] }),
      tClients: thanksLine({ type: agency, use: clients, help: [] }),
      tOwn: thanksLine({ type: gov, use: own, help: [] }),
      tEdge: thanksLine({ type: agency, use: own, help: [] }),
    };
  })()`);
  assert.deepEqual([rules.vClients, rules.vResell, rules.vGov, rules.vOther], ['clients', 'clients', 'gov', 'other']);
  assert.match(rules.tCreator, /^Thanks for stopping by/);
  assert.match(rules.tCreatorAgency, /Edge/);
  assert.match(rules.tPartner, /partners offer/);
  assert.match(rules.tClients, /one of your clients/);
  assert.match(rules.tOwn, /your own brand/);
  assert.match(rules.tEdge, /Edge/);
  console.log('rules: ok', rules);

  // Idle reset: answers and inputs are cleared after the (shortened) idle timer.
  await go(PAGE + '?idle=2&thanks=2');
  await click('#start'); await tap('Agency');
  await sleep(2600);
  assert.equal(await visible(), 'welcome');
  await click('#start');
  assert.equal(await js(`document.querySelectorAll('.opt[aria-pressed=true]').length`), 0);
  await js(`answers = { type: ['Agency (creative, social, media or influencer)'] }; show('details')`);
  await fill('#f-name', 'Idle Person'); await js(`document.querySelector('#f-consent').checked = true`);
  await sleep(2600);
  assert.equal(await visible(), 'welcome');
  assert.deepEqual(await js(`[document.querySelector('#f-name').value, document.querySelector('#f-consent').checked, JSON.stringify(answers)]`), ['', false, '{}']);
  console.log('idle reset: ok');

  // Offline queue: submit with the network down, then restore it. Exactly one POST arrives.
  if (LIVE) await page('Fetch.disable');
  posts = 0;
  await go(PAGE + '?thanks=60');
  offline = true;
  await page('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(300);
  await click('#start');
  await tap('Agency'); await click('#next');
  await tap('Director'); await sleep(400);
  await tap('Our own brand'); await click('#next');
  await tap('Portugal'); await click('#next');
  await tap('Finding'); await click('#next');
  await tap('Another platform'); await sleep(400);
  await fill('#q-text', 'TEST platform'); await js(`document.querySelector('#q-text').dispatchEvent(new Event('input'))`);
  await click('#next'); await tap('4 to 10'); await sleep(400);
  await tap('In the next'); await sleep(400);
  await fill('#f-name', 'TEST Koulouris kiosk offline'); await fill('#f-company', 'TEST');
  await fill('#f-email', 'test.kiosk@example.com'); await js(`document.querySelector('#f-consent').checked = true`);
  await click('#details button[type=submit]');
  await sleep(1500);
  const whileOffline = await js(`({ queued: queue().length, dot: document.getElementById('dot').className, count: document.getElementById('dot').textContent, screen })`);
  assert.deepEqual(whileOffline, { queued: 1, dot: 'queued', count: '1', screen: 'thanks' });
  assert.equal(posts, 0);
  if (OUT) await shot('offline-queued-dot');
  offline = false;
  await page('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  for (let i = 0; i < 100 && (await js('queue().length')) > 0; i++) await sleep(100);
  assert.equal(await js('queue().length'), 0, 'the online event should drain the queue');
  // A second flush must not send it again.
  await js('flush()'); await sleep(1500);
  const online = await js(`({ queued: queue().length, dot: document.getElementById('dot').className })`);
  assert.deepEqual(online, { queued: 0, dot: '' });
  assert.equal(posts, 1);
  if (OUT) await shot('online-queue-empty-dot');
  console.log('offline queue: ok, posts =', posts, LIVE ? '(live)' : '(intercepted)');
  console.log('PASS');
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
