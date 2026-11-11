// Checks for mailer-standalone.gs, the standalone thank-you mailer. No network, no Google: Apps Script's services are stubbed.
// Usage: node mailer-check.mjs   (healthy output ends with PASS (N checks))
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = readFileSync(new URL('mailer-standalone.gs', import.meta.url), 'utf8');
const WS = SRC.includes("at('Full name')"), ME = SRC.match(/const SENDER = \{[^}]*email: '([^']+)'/)[1], GEORGE = 'george.koulouris@renfluence.com';
const HEAD = WS ? ['Timestamp', 'Full name', 'Work email', 'Consent', 'Tablet', 'Score', 'Owner'] : ['Timestamp', 'First name', 'Last name', 'Email', 'Phone', 'Business type', 'Tablet', 'Owner'];
const row = (name, email, consent = 'I agree') => { const [f, ...l] = name.split(' '); return WS ? ['t', name, email, consent, 'T1', '70', 'Petros'] : ['t', f, l.join(' '), email, '', 'Hotel', 'T1', 'Έλη']; };

class FakeSheet { // a grid; rows and columns count from 1 like Apps Script's
  constructor(rows, head = HEAD) { this.g = [head.slice(), ...rows]; }
  getSheetId() { return 42; }
  getLastRow() { return this.g.length; }
  getLastColumn() { return Math.max(0, ...this.g.map((r) => r.length)); }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (s.g[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getValue: () => (s.g[r - 1] || [])[c - 1] ?? '',
      setValue(x) { (s.g[r - 1] ||= [])[c - 1] = x; return this; }, setFontWeight() { return this; },
    };
  }
}

function load({ flag = true, rows = [], props = {}, user = ME, first = 2, failSend = false, head = HEAD, notifyFirst = 2, notify = true } = {}) {
  const sheet = new FakeSheet(rows, head), p = { ...props }, cache = {}, calls = { sent: [], log: [], flushes: 0, triggers: [] };
  const ctx = vm.createContext({
    console: { log: (...a) => calls.log.push(a.join(' ')) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => p[k] ?? null, setProperty: (k, v) => { p[k] = v; } }) },
    GmailApp: { sendEmail: (to, subject, text, o) => { if (failSend) throw new Error('boom'); calls.sent.push({ to, subject, text, o, sheetThen: JSON.stringify(sheet.g) }); } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    SpreadsheetApp: { openById: () => ({ getSheets: () => [sheet] }), flush: () => { calls.flushes++; } },
    Session: { getEffectiveUser: () => ({ getEmail: () => user }) },
    ScriptApp: { getProjectTriggers: () => calls.triggers, deleteTrigger: (t) => calls.triggers.splice(calls.triggers.indexOf(t), 1),
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => calls.triggers.push({ getHandlerFunction: () => fn, n }) }) }) }) },
  });
  const src = SRC.replace(/^const SEND_THANK_YOU = (true|false);$/m, 'const SEND_THANK_YOU = ' + flag + ';');
  assert.notEqual(src, '', 'flag line not found'); assert.match(SRC, /^const SEND_THANK_YOU = (true|false);$/m);
  vm.runInContext(src.replace(/const FIRST_ROW = \d+;/, 'const FIRST_ROW = ' + first + ';').replace(/const NOTIFY_FIRST_ROW = \d+;/, 'const NOTIFY_FIRST_ROW = ' + notifyFirst + ';').replace(/const NOTIFY_OWNERS = (true|false);/, 'const NOTIFY_OWNERS = ' + notify + ';'), ctx);
  return { run: (e) => vm.runInContext(e, ctx), calls, sheet, props: p };
}
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok: ' + name); };
const col = (s, h) => s.g[0].indexOf(h);
const markers = (s) => s.g.slice(1).map((r) => r[col(s, 'Thank-you sent')] ?? '');

ok('SEND_THANK_YOU = false is fully off: nothing sent, Sheet untouched, no trigger installed', () => {
  const m = load({ flag: false, rows: [row('Ana Silva', 'ana@hotel.pt')] });
  m.run('sendPending()');
  assert.equal(m.calls.sent.length, 0); assert.equal(m.calls.triggers.length, 0); assert.deepEqual(m.sheet.g[0], HEAD); // the Sheet is untouched
});
ok('flag on: mails the address, from the info@ mailbox name, reply-to info@, marker written BEFORE the send', () => {
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')] });
  m.run('sendPending()');
  const s = m.calls.sent;
  assert.equal(s.length, 1); assert.equal(s[0].to, 'ana@hotel.pt'); assert.equal(s[0].o.replyTo, ME); assert.equal(s[0].o.name, WS ? 'Renfluence' : 'easyInfluencer'); assert.ok(!('from' in s[0].o));
  assert.match(s[0].text, /^Hi Ana,/); assert.match(s[0].o.htmlBody, /Hi Ana, thanks/);
  assert.match(s[0].sheetThen, /sending 20/); assert.match(markers(m.sheet)[0], /^sent 20/); assert.ok(m.calls.flushes >= 1);
});
ok('a second run sends nothing more', () => {
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')] });
  m.run('sendPending()'); m.run('sendPending()');
  assert.equal(m.calls.sent.length, 1);
});
ok('invalid address is skipped and marked, nothing sent', () => {
  const m = load({ rows: [row('Ana Silva', 'not-an-address'), row('Bo Li', 'a@b.pt, c@d.pt')] });
  m.run('sendPending()');
  assert.equal(m.calls.sent.length, 0); assert.deepEqual(markers(m.sheet), ['skipped: invalid email', 'skipped: invalid email']);
});
ok('TEST rows are skipped unless TEST_TO is George, then only George gets it', () => {
  const t = [row('TEST Ana', 'ana@hotel.pt')];
  const a = load({ rows: t }); a.run('sendPending()'); assert.equal(a.calls.sent.length, 0); assert.equal(markers(a.sheet)[0], 'skipped: test lead');
  const b = load({ rows: t, props: { TEST_TO: GEORGE } }); b.run('sendPending()'); assert.deepEqual(b.calls.sent.map((x) => x.to), [GEORGE]);
});
ok('same address twice within 6 hours: one mail', () => {
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt'), row('Ana S', 'Ana@Hotel.pt')] });
  m.run('sendPending()');
  assert.equal(m.calls.sent.length, 1); assert.equal(markers(m.sheet)[1], 'skipped: same address within 6 hours');
});
ok('a failed send is marked failed and never retried', () => {
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')], failSend: true });
  m.run('sendPending()'); assert.match(markers(m.sheet)[0], /^failed 20.*boom/);
  const k = m.calls.sent.length; m.run('sendPending()'); assert.equal(m.calls.sent.length, k); assert.match(markers(m.sheet)[0], /^failed/);
});
ok('FIRST_ROW: earlier rows are never mailed or marked', () => {
  const m = load({ first: 3, rows: [row('Old Test', 'old@x.pt'), row('Ana Silva', 'ana@hotel.pt')] });
  m.run('sendPending()');
  assert.deepEqual(m.calls.sent.map((x) => x.to), ['ana@hotel.pt']); assert.equal(markers(m.sheet)[0], '');
});
ok('the marker column is added at the right only when there is a row to try', () => {
  const none = load({ rows: [] }); none.run('sendPending()'); assert.deepEqual(none.sheet.g[0], HEAD);
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')] }); m.run('sendPending()'); assert.equal(m.sheet.g[0].at(-1), 'Thank-you sent'); assert.equal(m.sheet.g[0].length, HEAD.length + 1);
});
ok('runs as another account: throws, sends nothing', () => {
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')], user: 'someone@else.com' });
  assert.throws(() => m.run('sendPending()'), /not /); assert.throws(() => m.run('sendTestMail()'), /not /); assert.equal(m.calls.sent.length, 0);
});
ok('daily cap leaves the row unmarked for the next run', () => {
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')], props: { TY_COUNT: new Date().toISOString().slice(0, 10) + ':300' } });
  m.run('sendPending()'); assert.equal(m.calls.sent.length, 0); assert.equal(markers(m.sheet)[0], '');
});
ok('dryRun sends and writes nothing, and logs row numbers only (no visitor address or name)', () => {
  const m = load({ flag: false, rows: [row('Ana Silva', 'ana@hotel.pt'), row('TEST Bo', 'bo@x.pt'), row('Cy Do', 'bad')] });
  m.run('dryRun()');
  assert.equal(m.calls.sent.length, 0); assert.deepEqual(m.sheet.g[0], HEAD);
  const log = m.calls.log.join('\n');
  assert.match(log, /row 2: would send/); assert.match(log, /row 3: would skip: test lead/); assert.match(log, /row 4: would skip: invalid email/);
  assert.ok(!/ana@hotel|Ana Silva|bo@x|Cy Do/.test(log));
});
ok('sendTestMail sends exactly one mail, to George, and marks nothing, even with the flag off', () => {
  const m = load({ flag: false, rows: [row('Ana Silva', 'ana@hotel.pt')] });
  m.run('sendTestMail()');
  assert.deepEqual(m.calls.sent.map((x) => x.to), [GEORGE]); assert.deepEqual(m.sheet.g[0], HEAD);
});
ok(WS ? 'Renfluence: no voucher text, no empty voucher box; a row without consent gets nothing' : 'easyInfluencer: the voucher line is in both versions', () => {
  if (WS) {
    const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt'), row('Bo Li', 'bo@x.pt', '')] }); m.run('sendPending()');
    assert.deepEqual(m.calls.sent.map((x) => x.to), ['ana@hotel.pt']); assert.equal(markers(m.sheet)[1], 'skipped: no consent');
    assert.ok(!/WEBSUMMIT|voucher|\{\{/.test(m.calls.sent[0].o.htmlBody + m.calls.sent[0].text));
  } else {
    const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')] }); m.run('sendPending()'); const x = m.calls.sent[0];
    assert.match(x.text, /Use code WEBSUMMIT26 for 50% off your first paid month, valid until 17 Nov\./); assert.match(x.o.htmlBody, /WEBSUMMIT26/); assert.ok(!/\{\{/.test(x.o.htmlBody + x.text));
  }
});
ok(WS ? 'Renfluence blue is #0047FF, never the old #0051FD' : 'easyInfluencer: orange #FF6600 background', () => {
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')] }); m.run('sendPending()'); const h = m.calls.sent[0].o.htmlBody;
  if (WS) { assert.ok(!/0051FD/i.test(h)); assert.match(h, /<table[^>]*bgcolor="#0047FF"/); assert.match(h, /#00F1FF/); } else assert.match(h, /<table[^>]*bgcolor="#FF6600"/);
});
ok('dark mode (Gmail, Samsung): every element with a background colour carries the same colour as a gradient; light-only metas; dark overrides', () => {
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')] }); m.run('sendPending()'); const h = m.calls.sent[0].o.htmlBody;
  assert.match(h, /<meta name="color-scheme" content="light only">/); assert.match(h, /<meta name="supported-color-schemes" content="light only">/);
  assert.match(h, /@media \(prefers-color-scheme: dark\)/); assert.match(h, /\[data-ogsb\] \.bgc-/); assert.match(h, /\[data-ogsc\] \.c-/);
  const tags = [...h.matchAll(/<(?:body|table|td|tr|a|div)\b[^<>]*?>/g)].map((t) => t[0]).filter((t) => /background-color:\s*#/.test(t));
  assert.ok(tags.length >= 6, 'found only ' + tags.length + ' coloured elements');
  tags.forEach((t) => { const x = t.match(/background-color:\s*(#[0-9a-fA-F]{6})/)[1]; assert.ok(t.includes(`linear-gradient(${x},${x})`), 'no gradient twin: ' + t.slice(0, 90)); assert.ok(t.includes('bgc-' + x.slice(1).toLowerCase())); });
  const brand = WS ? '#0047FF' : '#FF6600'; assert.ok(tags.some((t) => t.includes(`background-color:${brand}`) && t.includes(`linear-gradient(${brand},${brand})`)), 'brand colour has no gradient twin');
  assert.ok(tags.some((t) => t.includes('background-color:#FFFFFF') && t.includes('linear-gradient(#FFFFFF,#FFFFFF)')), 'white card has no gradient twin');
  // every text element states its colour, so nothing is left to auto-inversion
  assert.ok(![...h.matchAll(/<td\b[^<>]*>\s*(?=[A-Za-z])/g)].some((t) => !/color:#/.test(t[0]) && !/bgcolor/.test(t[0])), 'a text cell without its own colour');
});
ok('links: every href is https, lands on the English site with UTM, never renfluence.com, never /el/; ampersands escaped in the HTML', () => {
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')] }); m.run('sendPending()'); const x = m.calls.sent[0], h = x.o.htmlBody;
  const want = WS ? 'https://www.renfluence.ai/en/?utm_source=email&amp;utm_medium=thankyou&amp;utm_campaign=websummit' : 'https://easyinfluencer.travel/web-summit?utm_source=email&amp;utm_medium=thankyou&amp;utm_campaign=websummit';
  const hrefs = [...h.matchAll(/href="([^"]*)"/g)].map((r) => r[1]);
  assert.ok(hrefs.length >= 4, 'logo, VML button, button and sign-off: ' + hrefs.length);
  hrefs.forEach((u) => { assert.equal(u, want); assert.ok(u.startsWith('https://') && !/\/el\//.test(u) && !/renfluence\.com/.test(u)); });
  assert.ok(x.text.includes(want.replace(/&amp;/g, '&')) && !/renfluence\.com\/|\/el\//.test(x.text.replace(/info@renfluence\.com/g, '')));
});
ok('a name with HTML is escaped in the HTML version', () => {
  const m = load({ rows: [row('<b>Ana</b> Silva', 'ana@hotel.pt')] }); m.run('sendPending()');
  assert.ok(!m.calls.sent[0].o.htmlBody.includes('<b>Ana')); assert.match(m.calls.sent[0].o.htmlBody, /&lt;b&gt;Ana&lt;\/b&gt;/);
});
ok('installTrigger makes one 5-minute trigger, calling it again does not stack, removeTrigger clears it', () => {
  const m = load(); m.run('installTrigger()'); m.run('installTrigger()');
  assert.equal(m.calls.triggers.length, 1); assert.equal(m.calls.triggers[0].n, 5); m.run('removeTrigger()'); assert.equal(m.calls.triggers.length, 0);
});
ok('no trial length in any mail: no "trial", "15 days" or "30 days" in text or HTML (George: unresolved, 15 vs 30)', () => {
  const m = load({ rows: [row('Ana Silva', 'ana@hotel.pt')] }); m.run('sendPending()'); m.run('sendTestMail()');
  m.calls.sent.forEach((x) => assert.ok(!/trial|\b(15|30)[\s-]*days?\b/i.test(x.text + x.o.htmlBody)));
});
// Owner notification (Renfluence only): the lead mail to Petros and the others, sent from the info@ mailbox, never from George's.
if (WS) {
  const NH = ['Full name', 'Company', 'Work email', 'Product', 'Timestamp', 'Which best describes you?', 'Consent', 'Tablet', 'Spoke with', 'Score', 'Band', 'Routed owner', 'Owner', 'Thank-you sent']; // the live Sheet's order since 11 Nov: Timestamp is not column A
  const lead = (o = {}) => { const d = { ts: 't', type: 'Agency (creative, social, media or influencer)', name: 'Ana Silva', company: 'Hotel Lisboa', email: 'ana@hotel.pt', consent: 'I agree', tablet: 'T1', who: 'Theo', score: 77, band: 'Hot', product: 'Partnership', routed: 'Petros', owner: 'Petros', ty: '', ...o };
    return [d.name, d.company, d.email, d.product, d.ts, d.type, d.consent, d.tablet, d.who, d.score, d.band, d.routed, d.owner, d.ty]; };
  const nload = (rows, o = {}) => load({ rows, head: NH, ...o });
  const nmark = (m, i = 0) => m.sheet.g[1 + i][m.sheet.g[0].indexOf('Owner notified')] ?? '';
  ok('notifyOwners: one short mail from the info@ mailbox to the owner, first name only, marker written BEFORE the send, once', () => {
    const m = nload([lead()]); m.run('notifyOwners()'); m.run('notifyOwners()');
    assert.equal(m.calls.sent.length, 1); const x = m.calls.sent[0];
    assert.equal(x.to, 'petros@renfluence.com'); assert.equal(x.subject, 'New Web Summit lead: Ana Hotel Lisboa');
    assert.equal(x.o.name, 'Renfluence'); assert.equal(x.o.replyTo, ME); assert.ok(!('from' in x.o) && !('htmlBody' in x.o), 'plain text, no alias');
    assert.equal(x.text, ['Name: Ana', 'Company: Hotel Lisboa', 'Business type: Agency (creative, social, media or influencer)', 'Score: 77 (Hot)', 'Product: Partnership', 'Spoke with: Theo', '',
      'Sheet row: https://docs.google.com/spreadsheets/d/1gL3qWTlDSQkDGJT86B1mW1s3vtEy46-YD_zRfXsbxJE/edit#gid=42&range=A2'].join('\n'));
    assert.ok(!/Silva|ana@hotel/.test(x.text + x.subject), 'no surname, no email, no phone');
    assert.match(x.sheetThen, /sending 20/); assert.match(nmark(m), /^sent 20/); assert.equal(m.sheet.g[0].at(-1), 'Owner notified'); assert.equal(m.sheet.g[0].length, NH.length + 1);
  });
  ok('notifyOwners: the Owner cell wins, then the routed owner; unknown routing ("Check with Petros") goes to Petros', () => {
    const m = nload([lead({ owner: 'Panagiotis' }), lead({ owner: '', routed: 'Panagiotis', name: 'Bo Li' }), lead({ owner: '', routed: 'Check with Petros', name: 'Cy Do' }), lead({ owner: 'George Karavokyris', name: 'Di Er' })]);
    m.run('notifyOwners()');
    assert.deepEqual(m.calls.sent.map((x) => x.to), ['panagiotis@renfluence.com', 'panagiotis@renfluence.com', 'petros@renfluence.com', 'george@renfluence.com']);
  });
  ok('notifyOwners: an owner without an address is skipped, marked and logged, nobody is mailed', () => {
    const m = nload([lead({ owner: 'Theo' }), lead({ owner: 'constructor', name: 'Bo Li' })]); m.run('notifyOwners()');
    assert.equal(m.calls.sent.length, 0); assert.equal(nmark(m, 0), 'skipped: no address for owner Theo'); assert.equal(nmark(m, 1), 'skipped: no address for owner constructor');
    assert.match(m.calls.log.join('\n'), /row 2: skipped: no address for owner Theo/);
  });
  ok('notifyOwners: TEST rows are skipped; with TEST_TO set to George only George gets it, with a line saying who it would have gone to', () => {
    const t = [lead({ name: 'TEST Ana' })];
    const a = nload(t); a.run('notifyOwners()'); assert.equal(a.calls.sent.length, 0); assert.equal(nmark(a), 'skipped: test lead');
    const b = nload(t, { props: { TEST_TO: 'someone@else.com' } }); b.run('notifyOwners()'); assert.equal(b.calls.sent.length, 0);
    const c = nload(t, { props: { TEST_TO: GEORGE } }); c.run('notifyOwners()');
    assert.deepEqual(c.calls.sent.map((x) => x.to), [GEORGE]); assert.match(c.calls.sent[0].text, /Test lead: this would have gone to Petros\.$/); assert.equal(c.calls.sent[0].subject, 'New Web Summit lead: TEST Hotel Lisboa');
  });
  ok('notifyOwners: NOTIFY_FIRST_ROW protects old leads, they are never notified or marked', () => {
    const m = nload([lead({ name: 'Old One' }), lead({ name: 'Old Two' }), lead({ name: 'New Three' })], { notifyFirst: 4 }); m.run('notifyOwners()');
    assert.deepEqual(m.calls.sent.map((x) => x.subject), ['New Web Summit lead: New Hotel Lisboa']); assert.equal(nmark(m, 0), ''); assert.equal(nmark(m, 1), ''); assert.match(nmark(m, 2), /^sent/);
  });
  ok('notifyOwners: a row whose Sheet formulas have not calculated yet is left unmarked and mailed on a later run', () => {
    const m = nload([lead({ band: '', product: '', score: '', routed: '', owner: '' })]); m.run('notifyOwners()');
    assert.equal(m.calls.sent.length, 0); assert.equal(nmark(m), ''); assert.match(m.calls.log.join('\n'), /row 2: waiting/);
    Object.assign(m.sheet.g[1], lead()); m.run('notifyOwners()'); assert.equal(m.calls.sent.length, 1); assert.match(nmark(m), /^sent/);
  });
  ok('notifyOwners: a failed send is marked failed and never retried; the row after it is still tried', () => {
    const m = nload([lead(), lead({ name: 'Bo Li' })], { failSend: true }); m.run('notifyOwners()');
    assert.match(nmark(m, 0), /^failed 20.*boom/); assert.match(nmark(m, 1), /^failed/); const k = m.calls.sent.length; m.run('notifyOwners()'); assert.equal(m.calls.sent.length, k);
  });
  // The name-only row below has its formulas filled on purpose: only the Timestamp check keeps it out.
  ok('notifyOwners: a company with line breaks cannot break the subject into headers; a name-only row (no Timestamp, like the hand-typed rows under the live leads) is ignored', () => {
    const m = nload([lead({ company: 'Evil\r\nBcc: x@y.com   Ltd' }), lead({ ts: '', name: 'Diogo Torres', company: 'Coframe.pt', email: '' })]); m.run('notifyOwners()');
    assert.equal(m.calls.sent.length, 1); assert.ok(!/[\r\n]/.test(m.calls.sent[0].subject)); assert.equal(m.calls.sent[0].subject, 'New Web Summit lead: Ana Evil Bcc: x@y.com Ltd'); assert.equal(nmark(m, 1), '');
  });
  ok('notifyOwners: NOTIFY_OWNERS false does nothing and touches nothing; another account throws and sends nothing', () => {
    const m = nload([lead()], { notify: false }); m.run('notifyOwners()'); assert.equal(m.calls.sent.length, 0); assert.equal(m.sheet.g[0].length, NH.length);
    const w = nload([lead()], { user: 'george.koulouris@renfluence.com' }); assert.throws(() => w.run('notifyOwners()'), /not /); assert.equal(w.calls.sent.length, 0);
  });
  ok('notifyOwners and the thank-you mail have separate markers and do not disturb each other', () => {
    const m = nload([lead()]); m.run('sendPending()'); m.run('notifyOwners()'); m.run('notifyOwners()'); m.run('sendPending()');
    assert.deepEqual(m.calls.sent.map((x) => x.to), ['ana@hotel.pt', 'petros@renfluence.com']); assert.match(m.sheet.g[1][NH.indexOf('Thank-you sent')], /^sent/); assert.match(nmark(m), /^sent/);
    assert.deepEqual(m.sheet.g[0].slice(0, NH.length), NH, 'no existing column moves');
  });
  ok('dryRunNotify sends and writes nothing, logs row numbers and owner addresses only (no visitor name, company or email)', () => {
    const m = nload([lead(), lead({ name: 'TEST Bo' }), lead({ owner: 'Theo', name: 'Cy Do' })]); m.run('dryRunNotify()');
    assert.equal(m.calls.sent.length, 0); assert.equal(m.sheet.g[0].length, NH.length);
    const log = m.calls.log.join('\n'); assert.match(log, /row 2: would send to petros@renfluence.com/); assert.match(log, /row 3: would skip: test lead/); assert.match(log, /row 4: would skip: no address for owner Theo/);
    assert.ok(!/Ana|Silva|Hotel Lisboa|ana@hotel|Bo\b|Cy Do/.test(log));
  });
  ok('installNotifyTrigger makes one 5-minute trigger that does not stack, leaves the thank-you trigger alone, removeNotifyTrigger removes only its own', () => {
    const m = load(); m.run('installTrigger()'); m.run('installNotifyTrigger()'); m.run('installNotifyTrigger()');
    assert.deepEqual(m.calls.triggers.map((t) => [t.getHandlerFunction(), t.n]), [['sendPending', 5], ['notifyOwners', 5]]);
    m.run('removeNotifyTrigger()'); assert.deepEqual(m.calls.triggers.map((t) => t.getHandlerFunction()), ['sendPending']); m.run('removeTrigger()'); m.run('installNotifyTrigger()'); m.run('removeTrigger()'); assert.equal(m.calls.triggers.length, 1);
  });
  ok('the owner table has the four owners the capture script knew, all on renfluence.com', () => {
    const t = JSON.parse(JSON.stringify(load().run('OWNER_EMAIL')));
    assert.deepEqual(t, { Petros: 'petros@renfluence.com', Panagiotis: 'panagiotis@renfluence.com', 'George Karavokyris': 'george@renfluence.com', 'George Koulouris': 'george.koulouris@renfluence.com' });
  });
}
console.log(`PASS (${n} checks)`);
