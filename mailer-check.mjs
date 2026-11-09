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
  constructor(rows) { this.g = [HEAD.slice(), ...rows]; }
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

function load({ flag = true, rows = [], props = {}, user = ME, first = 2, failSend = false } = {}) {
  const sheet = new FakeSheet(rows), p = { ...props }, cache = {}, calls = { sent: [], log: [], flushes: 0, triggers: [] };
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
  let src = flag ? SRC.replace('const SEND_THANK_YOU = false;', 'const SEND_THANK_YOU = true;') : SRC;
  assert.equal(src !== SRC, flag, 'flag line not found');
  vm.runInContext(src.replace(/const FIRST_ROW = \d+;/, 'const FIRST_ROW = ' + first + ';'), ctx);
  return { run: (e) => vm.runInContext(e, ctx), calls, sheet, props: p };
}
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok: ' + name); };
const col = (s, h) => s.g[0].indexOf(h);
const markers = (s) => s.g.slice(1).map((r) => r[col(s, 'Thank-you sent')] ?? '');

ok('shipped with SEND_THANK_YOU = false and without a trigger', () => {
  assert.match(SRC, /^const SEND_THANK_YOU = false;$/m);
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
    assert.match(x.text, /code WEBSUMMIT26 gives 50% off your first paid month, valid until 17 Nov\. Trial: 15 days, with a card\./); assert.match(x.o.htmlBody, /WEBSUMMIT26/); assert.ok(!/\{\{/.test(x.o.htmlBody + x.text));
  }
});
ok('a name with HTML is escaped in the HTML version', () => {
  const m = load({ rows: [row('<b>Ana</b> Silva', 'ana@hotel.pt')] }); m.run('sendPending()');
  assert.ok(!m.calls.sent[0].o.htmlBody.includes('<b>Ana')); assert.match(m.calls.sent[0].o.htmlBody, /&lt;b&gt;Ana&lt;\/b&gt;/);
});
ok('installTrigger makes one 5-minute trigger, calling it again does not stack, removeTrigger clears it', () => {
  const m = load(); m.run('installTrigger()'); m.run('installTrigger()');
  assert.equal(m.calls.triggers.length, 1); assert.equal(m.calls.triggers[0].n, 5); m.run('removeTrigger()'); assert.equal(m.calls.triggers.length, 0);
});
console.log(`PASS (${n} checks)`);
