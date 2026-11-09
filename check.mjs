// End-to-end check in headless Chrome: every screen on common tablet and phone sizes in both orientations
// (screenshots plus a layout audit), the Q7 and thank-you rules, the idle and thank-you resets, the lead archive
// and CSV export, private-mode storage, the offline queue, the wording Sheet (stubbed CSV: edited label, unchanged post, cache,
// blank cell, error page), Q4's "Other in Europe" and "Elsewhere" lists and the optional «Something else» text on Q1 and Q2.
// Usage: node check.mjs [page-url] [screenshot-dir]
// By default formResponse is intercepted and answered locally. LIVE=1 lets the offline-queue submission
// (name "TEST Koulouris kiosk offline", tablet "TEST") through to the real Google Form: one row in the Sheet,
// which the owner script routes without an email because the name starts with TEST. Delete that row after.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const PAGE = process.argv[2] || new URL('index.html', import.meta.url).href;
const OUT = process.argv[3] || join(process.env.HOME, '.local/state/pi-subagents/ws-kiosk-check');
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
  await sleep(350);
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64'));
}
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const tap = (label) => js(`[...document.querySelectorAll('.opt')].find(b => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
const visible = () => js(`['welcome','question','details','thanks','export'].find(id => !document.getElementById(id).hidden)`);
const fill = (sel, v) => js(`document.querySelector(${JSON.stringify(sel)}).value = ${JSON.stringify(v)}`);
const input = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new Event('input', { bubbles: true }))`);
const archive = () => js(`JSON.parse(localStorage.getItem('ws-kiosk-archive') || '[]')`);

// Runs in the page: layout problems on the screen showing now.
function audit() {
  const bad = [], W = innerWidth, H = innerHeight;
  const vis = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + '[' + el.textContent.trim().slice(0, 20) + ']';
  if (document.documentElement.scrollWidth > W || document.body.scrollWidth > W) bad.push('page scrolls horizontally');
  const shown = [...document.querySelectorAll('.screen:not([hidden]) *')].filter(vis);
  for (const el of shown) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width && (r.left < -1 || r.right > W + 1)) bad.push('outside the viewport sideways: ' + name(el));
    // A text field holding more than it can show is normal, so inputs are left out.
    if (el.tagName !== 'INPUT' && cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) bad.push('scrolls sideways: ' + name(el));
    if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1) bad.push('text overflows: ' + name(el));
    const target = el.matches('button:not([disabled]), input:not([type=checkbox]), .consent');
    if (target && (r.height < 40 || r.width < 40)) bad.push('tiny target ' + Math.round(r.width) + 'x' + Math.round(r.height) + ': ' + name(el));
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !el.closest('#dot, #device') && parseFloat(cs.fontSize) < 11) bad.push('text under 11px: ' + name(el));
    if (el.matches('#start, #next, #back, #details-back, #details button[type=submit], #next-visitor, #x-csv, #x-retry') && (r.top < -1 || r.bottom > H + 1)) bad.push('button off screen: ' + name(el));
  }
  const rect = (sel) => document.querySelector('.screen:not([hidden]) ' + sel)?.getBoundingClientRect();
  const [bar, stage, nav, a, b] = ['.bar', '.stage', '.nav', '.stage > div:first-child', '.stage > div:last-child'].map(rect);
  if (stage && bar && bar.bottom > stage.top + 1) bad.push('bar overlaps the stage');
  if (stage && nav && stage.bottom > nav.top + 1) bad.push('stage overlaps the nav');
  if (a && b && a.right > b.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1 && a.top < b.bottom) bad.push('title overlaps the options');
  const scrolls = [...document.querySelectorAll('.screen:not([hidden]) :is(.stage, .stage > div, .welcome-body)')].some((el) => el.scrollHeight > el.clientHeight + 1);
  const shownIds = ['welcome', 'question', 'details', 'thanks'].filter((id) => !document.getElementById(id).hidden);
  if (shownIds.some((id) => /export/i.test(document.getElementById(id).outerHTML))) bad.push('the kiosk flow mentions export');
  return { bad, scrolls };
}
const problems = [], scrollsOn = new Map();
async function snap(tag, name) {
  await shot(name);
  const { bad, scrolls } = await js(`(${audit})()`);
  bad.forEach((b) => problems.push(`${tag} ${name}: ${b}`));
  if (scrolls) scrollsOn.set(tag, [...(scrollsOn.get(tag) || []), name.replace(/^.*?-(\d\d)-/, '')]);
}

// One whole visit through the kiosk, ending on the thank-you screen.
async function lead({ name = 'Check Person', company = 'Check Co', email = 'check.person@example.com', phone = '', platform = false, agency = 'Agency', typeText = '', roleText = '' } = {}) {
  await click('#start');
  await tap(typeText ? 'Something else' : agency);
  if (typeText) { await fill('#q-text', typeText); await input('#q-text'); }
  await click('#next');
  await tap(roleText ? 'Something else' : 'Director'); await sleep(400);
  if (roleText) { await fill('#q-text', roleText); await input('#q-text'); await click('#next'); }
  await tap('Our own brand'); await click('#next');
  await tap('Portugal'); await click('#next');
  await tap('Finding'); await click('#next');
  if (platform) {
    await tap('Another platform'); await sleep(500);
    await fill('#q-text', 'TEST platform'); await input('#q-text');
    await click('#next');
  } else { await tap('Our own tool'); await sleep(400); }
  await tap('4 to 10'); await sleep(400);
  await tap('In the next'); await sleep(400);
  await fill('#f-name', name); await fill('#f-company', company); await fill('#f-email', email); await fill('#f-phone', phone);
  await js(`document.querySelector('#f-consent').checked = true`);
  await click('#details button[type=submit]');
}

// A small CSV reader (quoted fields, doubled quotes, CRLF) to check the export the way Excel would read it.
function parseCsv(text) {
  const rows = [[]]; let f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { rows.at(-1).push(f); f = ''; }
    else if (c === '\n') { rows.at(-1).push(f.replace(/\r$/, '')); f = ''; rows.push([]); }
    else f += c;
  }
  if (f || rows.at(-1).length) rows.at(-1).push(f);
  return rows.filter((r) => r.length);
}
const SIZES = [[1180, 820], [1133, 744], [1280, 800], [1024, 768], [1366, 1024], [390, 844], [360, 640], [1280, 600]];
// Contrast of Renfluence's light blue on the brand blue (WCAG): large bold text needs 3:1.
const lum = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
assert.ok(contrast('#00F0FF', '#0051FD') >= 3, 'tagline contrast');
const ATHENS_ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+0[23]:00$/;

// The wording Sheet's CSV: null fails the request (offline), a string is served as the response. The real Sheet is never read.
let posts = 0, offline = false, texts = null;



const dl = mkdtempSync(join(tmpdir(), 'ws-kiosk-dl-'));
try {
  await connect(wsUrl);
  ({ sessionId: sid } = await send('Target.attachToTarget', {
    targetId: (await send('Target.createTarget', { url: 'about:blank' })).targetId, flatten: true }));
  await page('Page.enable');
  await page('Network.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  listeners.push((m) => {
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      if (request.url.includes('/gviz/')) texts === null
        ? page('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' })
        : page('Fetch.fulfillRequest', { requestId, responseCode: 200, body: Buffer.from(texts).toString('base64'),
          responseHeaders: [{ name: 'content-type', value: 'text/csv' }, { name: 'access-control-allow-origin', value: '*' }] });
      else offline
        ? page('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' })
        : page('Fetch.fulfillRequest', { requestId, responseCode: 200, body: '' });
    }
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('formResponse')) posts++;
  });
  // The run never reaches the real form, except the one LIVE lead at the end.
  await page('Fetch.enable', { patterns: [{ urlPattern: '*formResponse*' }, { urlPattern: '*gviz*' }] });
  mkdirSync(OUT, { recursive: true });
  // Counts the navigator.storage.persist() calls the page makes on load.
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.__persist = 0;
    try { const s = navigator.storage, p = s.persist.bind(s); s.persist = () => { window.__persist++; return p(); }; } catch {}` });
  const mobile = (w, h) => page('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true,
    screenOrientation: { type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0 } });

  // Every screen on each tablet and phone size, landscape then portrait: a screenshot and a layout audit of each.
  // Each lead also lands in the archive, which has to grow by one per visit and survive the reload between visits.
  let expected = 0;
  // ONLY=1280x800,390x844 runs just those sizes while iterating.
  for (const [W, H] of SIZES.flatMap(([w, h]) => [[w, h], [h, w]]).filter(([w, h]) => !process.env.ONLY || process.env.ONLY.split(',').includes(`${w}x${h}`))) {
    const tag = `${W}x${H}`;
    await mobile(W, H);
    await go(PAGE);
    assert.equal((await archive()).length, expected, tag + ': the archive survives a reload');
    assert.ok(await js('window.__persist') >= 1, 'navigator.storage.persist() is called on load');
    assert.deepEqual(await js(`({ warn: document.getElementById('storage-warn').hidden, dev: document.getElementById('device').textContent, unset: document.getElementById('device').className })`),
      { warn: true, dev: 'Tablet: not set', unset: 'unset' });
    await snap(tag, `${tag}-01-welcome`);
    // The light-blue tagline sits right under the logo, inside the blue panel, clear of the Web Summit text, and large bold text (3:1 is enough).
    assert.deepEqual(await js(`(() => { const t = document.querySelector('.brand-tag'), l = document.querySelector('.brand img').getBoundingClientRect(),
      b = document.querySelector('.brand').getBoundingClientRect(), p = document.querySelector('.brand p').getBoundingClientRect(), r = t.getBoundingClientRect(), cs = getComputedStyle(t);
      return { text: t.textContent, color: cs.color, below: r.top >= l.bottom - 1 && r.top - l.bottom < 40, clear: r.bottom <= p.top,
        inside: r.left >= b.left && r.right <= b.right, large: parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700 }; })()`),
      { text: 'Where Content Meets Clarity', color: 'rgb(0, 240, 255)', below: true, clear: true, inside: true, large: true }, tag + ': tagline under the logo');
    await click('#start');
    await tap('Agency'); await tap('Government'); await snap(tag, `${tag}-02-q1-type-max2`);
    // "Something else" opens a text field on the same screen (optional). Tapping it again closes and clears it.
    const ASK = `({ open: document.querySelector('#q-ask').classList.contains('open'), inert: document.querySelector('#q-ask').inert, focus: document.activeElement.id,
      val: document.querySelector('#q-text').value, label: document.querySelector('label[for=q-text]').firstChild.textContent.trim(),
      high: document.querySelector('#q-ask').getBoundingClientRect().height > 40, count: document.querySelector('#count').textContent, screen })`;
    await tap('Government'); await tap('Something else'); await sleep(500);
    assert.deepEqual(await js(ASK), { open: true, inert: false, focus: 'q-text', val: '', label: 'What describes you?', high: true, count: '1 of 8', screen: 'question' }, tag + ': Q1 field opens inline');
    await fill('#q-text', 'Podcaster'); await input('#q-text'); await snap(tag, `${tag}-02b-q1-something-else`);
    assert.deepEqual(await js(`[answers.typeOther, answers.type.length, document.querySelector('#next').disabled]`), ['Podcaster', 2, false], tag + ': Q1 text kept, Next never blocked');
    await tap('Something else'); await sleep(400);
    assert.deepEqual(await js(`[document.querySelector('#q-ask').classList.contains('open'), document.querySelector('#q-ask').inert, document.querySelector('#q-text').value, answers.typeOther ?? null, answers.type.length]`),
      [false, true, '', null, 1], tag + ': tapping again closes and clears Q1');
    await tap('Government');
    await click('#next'); await snap(tag, `${tag}-03-q2-role`);
    await tap('Something else'); await sleep(600);
    assert.deepEqual(await js(ASK), { open: true, inert: false, focus: 'q-text', val: '', label: 'What is your role?', high: true, count: '2 of 8', screen: 'question' }, tag + ': Q2 field opens inline and stays on Q2');
    await fill('#q-text', 'Chief vibes officer'); await input('#q-text'); await snap(tag, `${tag}-03b-q2-something-else`);
    assert.equal(await js(`answers.roleOther`), 'Chief vibes officer');
    await tap('Something else'); await sleep(400);
    assert.deepEqual(await js(`[document.querySelector('#q-ask').classList.contains('open'), document.querySelector('#q-ask').inert, document.querySelector('#q-text').value, answers.roleOther ?? null, answers.role ?? null]`),
      [false, true, '', null, null], tag + ': tapping again closes and clears Q2');
    await tap('Director'); await sleep(400);
    await tap('Our own brand'); await snap(tag, `${tag}-04-q3-for-whom`);
    await click('#next'); await tap('Portugal'); await tap('Greece'); await snap(tag, `${tag}-05-q4-markets`);
    // "Other in Europe" opens the extra countries and the text field on the same screen. Closing it clears them.
    await tap('Other in Europe'); await sleep(500); await tap('Spain'); await tap('Italy'); await snap(tag, `${tag}-05b-q4-other-in-europe`);
    assert.deepEqual(await js(`({ open: document.querySelector('#q-more').classList.contains('open'), more: answers.more, count: document.querySelector('#count').textContent })`),
      { open: true, more: ['Italy', 'Spain'], count: '4 of 8' }, tag + ': extra countries open inline, in list order');
    await tap('Other in Europe'); await sleep(400);
    assert.deepEqual(await js(`({ open: document.querySelector('#q-more').classList.contains('open'), more: answers.more ?? null })`), { open: false, more: null }, tag + ': closing clears them');
    // "Elsewhere" opens its own list and field below, the same way. Both can be open at once, each clears only itself.
    const OPEN = (id) => `document.querySelector('#q-${id}').classList.contains('open')`;
    await tap('Elsewhere'); await sleep(500); await tap('Brazil'); await tap('Asia'); await snap(tag, `${tag}-05c-q4-elsewhere`);
    assert.deepEqual(await js(`({ el: ${OPEN('elsewhere')}, eu: ${OPEN('more')}, inert: document.querySelector('#q-elsewhere').inert, list: answers.elsewhere, count: document.querySelector('#count').textContent,
      high: document.querySelector('#q-elsewhere').getBoundingClientRect().height > 40, title: document.querySelector('#q-elsewhere .more-title').textContent })`),
      { el: true, eu: false, inert: false, list: ['Asia', 'Brazil'], count: '4 of 8', high: true, title: 'Which regions or countries?' }, tag + ': Elsewhere opens its own list, in list order');
    await tap('Other in Europe'); await sleep(500); await tap('Spain'); await snap(tag, `${tag}-05d-q4-both-open`);
    assert.deepEqual(await js(`[${OPEN('elsewhere')}, ${OPEN('more')}, answers.elsewhere, answers.more]`), [true, true, ['Asia', 'Brazil'], ['Spain']], tag + ': both open at once');
    await tap('Elsewhere'); await sleep(400);
    assert.deepEqual(await js(`[${OPEN('elsewhere')}, document.querySelector('#q-elsewhere').inert, ${OPEN('more')}, answers.elsewhere ?? null, answers.elsewhereText ?? null, answers.more]`),
      [false, true, true, null, null, ['Spain']], tag + ': closing Elsewhere clears only Elsewhere');
    await tap('Other in Europe'); await sleep(400);
    await click('#next'); await tap('Finding'); await tap('Seeing'); await tap('Tracking'); await snap(tag, `${tag}-06-q5-help-max3`);
    await click('#next'); await snap(tag, `${tag}-07-q6-today`);
    await tap('Another platform'); await sleep(500);
    // The follow-up opens on the same screen, takes focus, and the counter does not move.
    assert.deepEqual(await js(`({ open: document.querySelector('#q-ask').classList.contains('open'), focus: document.activeElement.id,
      title: document.querySelector('#q-title').textContent, count: document.querySelector('#count').textContent,
      screen, h: document.querySelector('#q-ask').getBoundingClientRect().height > 40 })`),
      { open: true, focus: 'q-text', title: 'How do you handle this today?', count: '6 of 8', screen: 'question', h: true });
    // Deselecting hides it and clears it.
    await fill('#q-text', 'x'); await input('#q-text');
    await tap('Another platform'); await sleep(400);
    assert.deepEqual(await js(`({ open: document.querySelector('#q-ask').classList.contains('open'), inert: document.querySelector('#q-ask').inert,
      val: document.querySelector('#q-text').value, ans: answers.platform ?? null, today: answers.today ?? null, next: document.querySelector('#next').disabled })`),
      { open: false, inert: true, val: '', ans: null, today: null, next: true });
    await tap('Another platform'); await sleep(500);
    await fill('#q-text', 'Modash'); await input('#q-text');
    await snap(tag, `${tag}-08-q6-another-platform-open`);
    await click('#next');
    assert.equal(await js(`document.querySelector('#count').textContent`), '7 of 8');
    await snap(tag, `${tag}-09-q7-volume-gov`);
    await tap('4 to 10'); await sleep(400); await snap(tag, `${tag}-10-q8-when`);
    await tap('In the next'); await sleep(400); await snap(tag, `${tag}-11-details`);
    await fill('#f-name', 'Inês'); await fill('#f-email', 'ines@'); await click('#details button[type=submit]');
    await snap(tag, `${tag}-12-details-errors`);
    await fill('#f-name', 'Inês Carvalho'); await fill('#f-company', 'Lisboa Câmara Comunicação');
    await fill('#f-email', 'ines.carvalho@example.pt'); await fill('#f-phone', '+351 912 847 193');
    await js(`document.querySelector('#f-consent').checked = true`); await js(`document.querySelectorAll('.bad').forEach(e => e.classList.remove('bad'))`);
    await js(`document.querySelectorAll('.err').forEach(e => e.textContent = '')`);
    await snap(tag, `${tag}-13-details-filled`);
    await click('#details button[type=submit]'); await snap(tag, `${tag}-14-thank-you`);
    expected++;
    assert.equal((await archive()).length, expected, tag + ': the archive grows on every submit');
    // The team screen on the same size.
    await go(PAGE + '?export');
    assert.deepEqual(await js(`({ screen: ['welcome','export'].find(id => !document.getElementById(id).hidden), n: document.getElementById('x-archived').textContent })`), { screen: 'export', n: String(expected) });
    await snap(tag, `${tag}-15-export`);
    console.log(tag.padEnd(10), problems.some((p) => p.startsWith(tag + ' ')) ? 'PROBLEMS' : 'ok', scrollsOn.has(tag) ? '(scrolls inside: ' + scrollsOn.get(tag).join(', ') + ')' : '(fits without scrolling)');
  }
  problems.forEach((p) => console.log('  ' + p));
  assert.deepEqual(problems, [], 'layout problems');
  await mobile(1280, 800);

  // The archive holds the answers in the Sheet's question order and the posted body, with the Athens submit time.
  const first = (await archive())[0];
  assert.match(first.ts, ATHENS_ISO);
  assert.equal(first.answers['Full name'], 'Inês Carvalho');
  assert.equal(first.answers['Which markets do you work in?'], 'Greece, Portugal');
  assert.equal(first.answers['How many campaigns or topics do you follow in a year?'], '4 to 10');
  assert.equal(new URLSearchParams(first.body).get('entry.810863017'), 'Inês Carvalho');
  assert.ok(first.sent, 'a lead that went through has its sent time');
  console.log('archive: ok,', expected, 'leads, first at', first.ts);

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

  // Q4 "Other in Europe": the extra countries and text post to the extra Form question «Other markets», and Q4's own checkbox keeps
  // only its original options, so the Sheet's scoring reads the same as before.
  await go(PAGE);
  await click('#start');
  await tap('Agency'); await click('#next'); await tap('Director'); await sleep(400); await tap('Our own brand'); await click('#next');
  await tap('Portugal'); await tap('Other in Europe'); await sleep(500);
  await tap('Spain');
  await fill('#q-more-text', 'Moldova'); await input('#q-more-text');
  await click('#next'); await tap('Finding'); await click('#next'); await tap('Our own tool'); await sleep(400);
  await tap('4 to 10'); await sleep(400); await tap('In the next'); await sleep(400);
  await fill('#f-name', 'Other Europe'); await fill('#f-company', 'Check Co'); await fill('#f-email', 'other.europe@example.com');
  await js(`document.querySelector('#f-consent').checked = true`);
  await click('#details button[type=submit]');
  const eu = (await archive()).at(-1), euBody = new URLSearchParams(eu.body);
  assert.deepEqual(euBody.getAll('entry.1319317527'), ['Portugal', 'Other in Europe'], 'Q4 posts only its own options');
  assert.deepEqual(euBody.getAll('entry.496172218'), ['Spain, Moldova'], 'extra countries and text post to «Other markets»');
  assert.equal(eu.answers['Other markets'], 'Spain, Moldova');
  assert.equal(new URLSearchParams((await archive())[0].body).get('entry.496172218'), null, 'no «Other markets» without Other in Europe');
  console.log('q4 other in europe: ok');

  // One visit with the open-ended answers set by `opts`; returns the archived record.
  async function visit(name, { q1 = 'Agency', q1text, q2 = 'Director', q2text, q4 = [], q4text = {} }) {
    await go(PAGE);
    await click('#start');
    await tap(q1); if (q1text) { await fill('#q-text', q1text); await input('#q-text'); }
    await click('#next');
    await tap(q2); if (q2text) { await fill('#q-text', q2text); await input('#q-text'); await click('#next'); } else await sleep(400);
    await tap('Our own brand'); await click('#next');
    await tap('Portugal'); for (const l of q4) { await tap(l); await sleep(400); }
    for (const [sel, v] of Object.entries(q4text)) { await fill(sel, v); await input(sel); }
    await click('#next'); await tap('Finding'); await click('#next'); await tap('Our own tool'); await sleep(400);
    await tap('4 to 10'); await sleep(400); await tap('In the next'); await sleep(400);
    await fill('#f-name', name); await fill('#f-company', 'Check Co'); await fill('#f-email', 'open.ended@example.com');
    await js(`document.querySelector('#f-consent').checked = true`);
    await click('#details button[type=submit]');
    const r = (await archive()).at(-1);
    return { r, b: new URLSearchParams(r.body) };
  }
  // Elsewhere alone, then with Other in Europe: one comma-joined «Other markets», Q4's own checkbox untouched.
  let v = await visit('Elsewhere Only', { q4: ['Elsewhere', 'Brazil', 'Asia'], q4text: { '#q-elsewhere-text': 'Chile' } });
  assert.deepEqual(v.b.getAll('entry.1319317527'), ['Portugal', 'Elsewhere'], 'Q4 posts only its own options');
  assert.deepEqual(v.b.getAll('entry.496172218'), ['Asia, Brazil, Chile'], 'Elsewhere posts to «Other markets»');
  assert.equal(v.r.answers['Other markets'], 'Asia, Brazil, Chile');
  v = await visit('Elsewhere Both', { q4: ['Other in Europe', 'Spain', 'Elsewhere', 'Asia'], q4text: { '#q-more-text': 'Moldova', '#q-elsewhere-text': 'Kenya' } });
  assert.deepEqual(v.b.getAll('entry.1319317527'), ['Portugal', 'Other in Europe', 'Elsewhere'], 'Q4 posts only its own options');
  assert.deepEqual(v.b.getAll('entry.496172218'), ['Spain, Moldova, Asia, Kenya'], 'both groups post, nothing lost');
  // Text only, no list pick, still posts.
  v = await visit('Elsewhere Text', { q4: ['Elsewhere'], q4text: { '#q-elsewhere-text': 'Kenya' } });
  assert.deepEqual(v.b.getAll('entry.496172218'), ['Kenya']);
  console.log('q4 elsewhere: ok');

  // «Something else» on Q1 and Q2: the Form's option has no free-text response, so the typed text posts to its own optional
  // Form question, and the option itself is posted exactly as before.
  v = await visit('Other Text', { q1: 'Something else', q1text: 'Podcaster, "live"', q2: 'Something else', q2text: 'Chief vibes officer' });
  assert.deepEqual([v.b.getAll('entry.1697022334'), v.b.getAll('entry.1788746037')], [['Something else'], ['Something else']], 'Q1 and Q2 still post only their option');
  assert.deepEqual([v.b.getAll('entry.415824857'), v.b.getAll('entry.1228148969')], [['Podcaster, "live"'], ['Chief vibes officer']], 'the typed text posts to its own questions');
  assert.deepEqual([v.r.answers['Q1 other text'], v.r.answers['Q2 other text']], ['Podcaster, "live"', 'Chief vibes officer']);
  v = await visit('No Other Text', {});
  assert.deepEqual([v.r.answers['Q1 other text'], v.r.answers['Q2 other text']], ['', ''], 'other leads have no text');
  assert.deepEqual([v.b.getAll('entry.415824857'), v.b.getAll('entry.1228148969')], [[], []], 'nothing posted without the text');
  v = await visit('Empty Other Text', { q1: 'Something else', q2: 'Something else', q2text: ' ' });
  assert.deepEqual([v.r.answers['Q1 other text'], v.r.answers['Q2 other text']], ['', ''], 'the field is optional, nobody is blocked');
  assert.deepEqual([v.b.getAll('entry.415824857'), v.b.getAll('entry.1228148969')], [[], []], 'an empty field posts nothing');
  console.log('something else: ok (typed text posts to its own Form questions)');

  // The wording Sheet. Two leads with the same taps, built-in text then edited text: the posted bodies are identical.
  const CSV = (rows) => rows.map((r) => r.map((v) => '"' + v.replace(/"/g, '""') + '"').join(',')).join('\r\n') + '\r\n';
  const cached = () => js(`JSON.parse(localStorage.getItem('ws-kiosk-texts') || '{}')`);
  const text = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).textContent`);
  await js(`localStorage.removeItem('ws-kiosk-texts')`);
  texts = null;
  await go(PAGE);
  assert.equal(await text('.welcome-body h1'), 'Creator intelligence', 'built-in text when the fetch fails');
  await lead({ name: 'Same Taps' });
  const bodyBuiltIn = (await archive()).at(-1).body;
  texts = CSV([['Αλλάζετε μόνο τη στήλη text.', '', ''], ['', '', ''], ['key', 'text', 'note'],
    ['intro.title', 'Edited headline', 'x'], ['start', '', 'blank cell'], ['type.agency', 'Studio', ''], ['type.agency.sub', 'film and design', ''],
    ['thanks.edge', 'Custom edge line.', ''], ['count', '{n} / {total}', ''], ['bogus.key', 'ignored', ''],
    ['brand', 'Web Summit\nLisbon', 'two lines'], ['brand.tagline', 'Edited tagline', 'under the logo']]);
  await go(PAGE);
  await sleep(500);
  assert.equal(await text('.welcome-body h1'), 'Edited headline', 'a changed label shows on screen');
  assert.equal(await text('#start'), 'Start', 'a blank cell falls back to the built-in text');
  assert.deepEqual(await cached(), { 'intro.title': 'Edited headline', 'type.agency': 'Studio', 'type.agency.sub': 'film and design',
    'thanks.edge': 'Custom edge line.', count: '{n} / {total}', brand: 'Web Summit\nLisbon', 'brand.tagline': 'Edited tagline' }, 'cache holds the good rows only');
  assert.equal(await text('.brand-tag'), 'Edited tagline', 'the tagline under the logo is editable in the wording Sheet');
  assert.equal(await js(`getComputedStyle(document.querySelector('.brand p')).whiteSpace`), 'pre-line');
  await click('#start');
  assert.deepEqual(await js(`[...document.querySelectorAll('.opt')].slice(0, 2).map(b => b.textContent)`), ['Studiofilm and design', 'Brand' + 'in-house marketing, content or social']);
  assert.equal(await text('#count'), '1 / 8');
  await js(`reset()`);
  await lead({ name: 'Same Taps', agency: 'Studio' });
  assert.equal((await archive()).at(-1).body, bodyBuiltIn, 'editing a label never changes what is posted');
  assert.equal(await text('#thanks-line'), 'Custom edge line.');
  console.log('texts: edited label shown, blank falls back, posted body unchanged');

  // New text waits for the welcome screen: a visitor mid-question never sees the wording change.
  await go(PAGE);
  await click('#start'); await tap('Studio');
  texts = CSV([['key', 'text', 'note'], ['intro.title', 'Second headline', ''], ['type.title', 'Changed question', '']]);
  await js('loadTexts()'); await sleep(500);
  assert.equal(await text('#q-title'), 'Which best describes you?', 'the visible question keeps its wording');
  await js(`reset()`);
  assert.equal(await text('.welcome-body h1'), 'Second headline', 'the next welcome screen has the new wording');
  await click('#start');
  assert.equal(await text('#q-title'), 'Changed question');

  // Offline load: the last good copy comes from the cache. An error page instead of a CSV changes nothing.
  texts = null;
  await go(PAGE);
  assert.equal(await text('.welcome-body h1'), 'Second headline', 'offline load uses the cached text');
  texts = '<html><body>Sign in</body></html>';
  await go(PAGE); await sleep(500);
  assert.equal(await text('.welcome-body h1'), 'Second headline', 'an error page keeps the cached text');
  assert.equal((await cached())['intro.title'], 'Second headline');
  texts = CSV([['key', 'text', 'note'], ['intro.title', '', '']]);
  await go(PAGE); await sleep(500);
  assert.equal(await text('.welcome-body h1'), 'Creator intelligence', 'a cell blanked in the Sheet goes back to the built-in text');
  texts = null;
  await js(`localStorage.removeItem('ws-kiosk-texts')`);
  await go(PAGE);
  console.log('texts: new text only on welcome, offline uses cache, error page and blank cell fall back');

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

  // Thank-you screen. The lead is queued and archived before it shows, so a reload there loses nothing.
  // The network is down for this part, so the queue cannot drain on its own.
  offline = true;
  await go(PAGE);
  const [q0, a0] = [await js('queue().length'), (await archive()).length];
  await lead({ name: 'Reload Safe' });
  assert.deepEqual(await js(`({ screen, queued: queue().length, archived: JSON.parse(localStorage.getItem('ws-kiosk-archive')).length })`),
    { screen: 'thanks', queued: q0 + 1, archived: a0 + 1 });
  await go(PAGE);
  assert.equal(await visible(), 'welcome');
  assert.deepEqual([await js('queue().length'), (await archive()).length], [q0 + 1, a0 + 1], 'a reload on the thank-you screen keeps the lead');
  // It returns to the start by itself after the default 25 s, even with taps on the thank-you screen meanwhile.
  await go(PAGE);
  await lead({ name: 'Default Timer' });
  assert.equal(await visible(), 'thanks');
  await sleep(10000);
  await js(`document.getElementById('thanks').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await sleep(13000);
  assert.equal(await visible(), 'thanks', 'still on the thank-you screen before 25 s');
  await sleep(3500);
  assert.equal(await visible(), 'welcome', 'back at the start 25 s after the thank-you');
  assert.deepEqual(await js(`[JSON.stringify(answers), document.querySelector('#f-name').value]`), ['{}', '']);
  // The Next visitor button resets at once.
  await lead({ name: 'Next Button' });
  assert.equal(await visible(), 'thanks');
  await click('#next-visitor');
  assert.equal(await visible(), 'welcome');
  assert.deepEqual(await js(`[JSON.stringify(answers), step, deadline]`), ['{}', 0, 0]);
  // Frozen timers (a sleeping tablet): the first tick or visibility change after waking resets it.
  await lead({ name: 'Frozen Timer' });
  await js(`deadline = Date.now() - 1; document.dispatchEvent(new Event('visibilitychange')); dispatchEvent(new Event('focus'))`);
  assert.equal(await visible(), 'welcome');
  offline = false;
  await js('flush()'); await sleep(1500);
  assert.equal(await js('queue().length'), 0);
  console.log('thank-you reset: ok (25 s, Next visitor, frozen timers, reload keeps the lead)');

  // Device name: set once on ?export, kept in localStorage, shown small on the welcome screen.
  await go(PAGE + '?export');
  await fill('#x-device', 'Tablet 1 · Petros'); await input('#x-device');
  assert.equal(await js(`localStorage.getItem('ws-kiosk-device')`), 'Tablet 1 · Petros');
  await go(PAGE);
  assert.deepEqual(await js(`({ dev: document.getElementById('device').textContent, unset: document.getElementById('device').className })`), { dev: 'Tablet 1 · Petros', unset: '' });
  await shot('device-set-welcome');

  // Export: counts, the Retry button, and a CSV that Excel and Google Sheets open correctly.
  // The last visit has awkward text: a comma, quotes, a line break and something Excel would run as a formula.
  offline = true;
  await go(PAGE);
  await lead({ name: 'Maria "Mimi" Silva, Jr.', company: '=HYPERLINK("http://x")', email: 'maria@example.pt', phone: '+351 912 847 193' });
  expected = (await archive()).length;
  await go(PAGE + '?export');
  assert.deepEqual(await js(`[document.getElementById('x-archived').textContent, document.getElementById('x-queued').textContent]`), [String(expected), '1']);
  await click('#x-retry'); await sleep(1500);
  assert.equal(await js(`document.getElementById('x-msg').textContent`), 'Not sent yet: check the WiFi and try again.');
  assert.equal(await js('queue().length'), 1);
  offline = false; posts = 0;
  await click('#x-retry'); await sleep(1500);
  assert.equal(await js(`document.getElementById('x-msg').textContent`), 'All leads sent.');
  assert.deepEqual(await js(`[document.getElementById('x-queued').textContent, queue().length]`), ['0', 0]);
  assert.equal(posts, 1, 'Retry sending now posts the queued lead once');
  assert.ok((await archive()).at(-1).sent, 'the archive records the sent time');
  await click('#x-csv');
  let file;
  for (let i = 0; i < 50 && !(file = readdirSync(dl).find((f) => f.endsWith('.csv'))); i++) await sleep(100);
  assert.ok(file, 'the CSV downloads');
  const raw = readFileSync(join(dl, file));
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM first');
  const rows = parseCsv(raw.toString('utf8').slice(1));
  assert.equal(rows.length, expected + 1);
  assert.ok(rows.every((r) => r.length === rows[0].length), 'every row has the same number of columns');
  assert.deepEqual(rows[0], ['Timestamp', 'Which best describes you?', 'What is your role?', 'Who would you use it for?', 'Which markets do you work in?',
    'What would help you most?', 'How do you handle this today?', 'Which platform?', 'How many clients do you run social or creator work for?',
    'How many campaigns or topics do you follow in a year?', 'How many creator or social campaigns do you run in a year?',
    'When would this be useful to you?', 'Full name', 'Company', 'Work email', 'Phone', 'Consent', 'Tablet', 'Other markets', 'Q1 other text', 'Q2 other text', 'Sent']);
  const col = (n) => rows[0].indexOf(n), last = rows.at(-1);
  assert.match(rows[1][0], ATHENS_ISO);
  assert.equal(rows[1][col('Full name')], 'Inês Carvalho');
  assert.equal(last[col('Full name')], 'Maria "Mimi" Silva, Jr.');
  assert.equal(last[col('Company')], `'=HYPERLINK("http://x")`);
  assert.equal(last[col('Phone')], '+351 912 847 193');
  assert.equal(last[col('Tablet')], 'Tablet 1 · Petros');
  const ot = rows.find((r) => r[col('Full name')] === 'Other Text');
  assert.deepEqual([ot[col('Q1 other text')], ot[col('Q2 other text')]], ['Podcaster, "live"', 'Chief vibes officer'], 'the CSV carries the typed text');
  assert.equal(rows.find((r) => r[col('Full name')] === 'Elsewhere Both')[col('Other markets')], 'Spain, Moldova, Asia, Kenya');
  assert.equal(rows[1][col('Tablet')], '', 'leads taken before the name was set have no tablet');
  assert.match(last[col('Sent')], ATHENS_ISO);
  assert.ok(raw.toString('utf8').split('\r\n')[1].startsWith('"'), 'fields are quoted');
  assert.equal(new URLSearchParams((await archive()).at(-1).body).get('entry.938892717'), 'Tablet 1 · Petros');
  console.log('export: ok,', rows.length - 1, 'rows,', file);
  await shot('export-after-download');

  // Private mode: localStorage refuses writes (old Safari) or refuses access altogether. The visitor flow carries on.
  const modes = {
    'writes throw': `Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };`,
    'access throws': `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });`,
  };
  for (const [mode, source] of Object.entries(modes)) {
    const { identifier } = await page('Page.addScriptToEvaluateOnNewDocument', { source });
    await go(PAGE);
    assert.deepEqual(await js(`({ hidden: document.getElementById('storage-warn').hidden, text: document.getElementById('storage-warn').textContent,
      bg: getComputedStyle(document.getElementById('storage-warn')).backgroundColor, screen })`),
      { hidden: false, text: 'Private mode: leads are not saved on this device', bg: 'rgb(200, 40, 60)', screen: 'welcome' }, mode);
    await shot('private-mode-' + mode.replace(' ', '-'));
    assert.equal((await js(`(${audit})()`)).bad.length, 0);
    offline = true;
    await lead({ name: 'Private Mode' });
    assert.equal(await visible(), 'thanks', mode + ': the visitor still reaches the thank-you screen');
    assert.equal(await js('queue().length'), 1, mode + ': the lead waits in memory for this page');
    offline = false;
    await js('flush()'); await sleep(1500);
    assert.equal(await js('queue().length'), 0);
    await page('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  await go(PAGE);
  assert.equal(await js(`document.getElementById('storage-warn').hidden`), true, 'no banner when storage works');
  console.log('private mode: ok (banner shown, visitor flow not stopped)');

  // Offline queue: submit with the network down, then restore it. Exactly one POST arrives.
  await js(`localStorage.clear()`);
  if (LIVE) await page('Fetch.disable');
  posts = 0;
  await go(PAGE + '?thanks=60');
  if (LIVE) await js(`localStorage.setItem('ws-kiosk-device', 'TEST')`);
  offline = true;
  await page('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(300);
  await lead({ name: 'TEST Koulouris kiosk offline', company: 'TEST', email: 'test.kiosk@example.com', platform: true, typeText: 'TEST q1 other', roleText: 'TEST q2 other' });
  await sleep(1500);
  const whileOffline = await js(`({ queued: queue().length, dot: document.getElementById('dot').className, count: document.getElementById('dot').textContent, screen })`);
  assert.deepEqual(whileOffline, { queued: 1, dot: 'queued', count: '1', screen: 'thanks' });
  assert.equal(posts, 0);
  assert.equal((await archive()).length, 1);
  assert.equal((await archive())[0].sent, null, 'not marked sent while it waits');
  // Same data as before the inline field: the platform entry and section 7 in pageHistory.
  const body = new URLSearchParams(await js(`queue()[0].body`));
  assert.equal(body.get('entry.1915961324'), 'TEST platform');
  assert.equal(body.get('entry.241266100'), 'Another platform');
  assert.equal(body.get('pageHistory'), '0,1,2,3,4,5,6,7,8,9,10');
  assert.equal(body.get('entry.938892717'), LIVE ? 'TEST' : null);
  assert.deepEqual([body.get('entry.415824857'), body.get('entry.1228148969')], ['TEST q1 other', 'TEST q2 other']);
  await shot('offline-queued-dot');
  offline = false;
  await page('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  for (let i = 0; i < 100 && (await js('queue().length')) > 0; i++) await sleep(100);
  assert.equal(await js('queue().length'), 0, 'the online event should drain the queue');
  // A second flush must not send it again.
  await js('flush()'); await sleep(1500);
  const online = await js(`({ queued: queue().length, dot: document.getElementById('dot').className })`);
  assert.deepEqual(online, { queued: 0, dot: '' });
  assert.equal(posts, 1);
  assert.equal((await archive()).length, 1, 'sending does not remove it from the archive');
  assert.match((await archive())[0].sent, ATHENS_ISO);
  await shot('online-queue-empty-dot');
  console.log('offline queue: ok, posts =', posts, LIVE ? '(live)' : '(intercepted)');
  console.log('PASS');
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
  rmSync(dl, { recursive: true, force: true });
}
