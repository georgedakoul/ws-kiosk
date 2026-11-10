// Unit checks for the thank-you email (thank-you.gs) and its hook in sheet-owner.gs (the Form trigger). No network, no Google: Apps Script's services are stubbed.
// Usage: node mail-check.mjs   (healthy output ends with PASS)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = (f) => new URL(f, import.meta.url);
const SRC = { mail: readFileSync(here('thank-you.gs'), 'utf8'), owner: readFileSync(here('sheet-owner.gs'), 'utf8') };
const plain = (x) => JSON.parse(JSON.stringify(x));
const GEORGE = 'george.koulouris@renfluence.com';

// A Sheet that is a grid: rows and columns count from 1, like Apps Script's.
class FakeSheet {
  constructor(rows = []) { this.g = rows; }
  getLastRow() { return this.g.length; }
  getLastColumn() { return Math.max(0, ...this.g.map((r) => r.length)); }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (s.g[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (s.g[r - 1 + i] ||= [])[c - 1 + j] = x; })); return this; },
      getValue: () => (s.g[r - 1] || [])[c - 1] ?? '',
      setValue(x) { (s.g[r - 1] ||= [])[c - 1] = x; return this; },
      setNumberFormat() { return this; }, setFontWeight() { return this; },
    };
  }
}

// One script project in a fresh sandbox. flag = SEND_THANK_YOU; props = Script Properties; status = what the provider answers.
function load({ flag = false, props = {}, sheet = new FakeSheet(), status = 200, offer = '' } = {}) {
  const calls = { flushes: 0, log: [], errors: [], fetch: [], gmail: [], owner: [] }, p = { ...props }, cache = {};
  const stubs = {
    console: { log: (...a) => calls.log.push(a.join(' ')), error: (...a) => calls.errors.push(a.join(' ')) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => p[k] ?? null, setProperty: (k, v) => { p[k] = v; } }) },
    UrlFetchApp: { fetch: (url, o) => { calls.fetch.push({ url, ...o, payload: JSON.parse(o.payload), sheetThen: JSON.stringify(sheet.g), flushes: calls.flushes }); return { getResponseCode: () => status, getContentText: () => JSON.stringify({ message: 'nope' }) }; } },
    GmailApp: { sendEmail: (...a) => calls.gmail.push(a) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActive: () => ({ getSheets: () => [sheet], getId: () => 'SHEETID', getUrl: () => 'https://sheet' }), flush: () => { calls.flushes++; } },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    MailApp: { sendEmail: (...a) => calls.owner.push(a) },
        Utilities: { formatDate: () => '2026-11-10 10:00', sleep() {} },
  };
  const ctx = vm.createContext(stubs);
  let mail = flag ? SRC.mail.replace('const SEND_THANK_YOU = false;', 'const SEND_THANK_YOU = true;') : SRC.mail;
  assert.equal(mail !== SRC.mail, flag, 'SEND_THANK_YOU line not found');
  if (offer) { const m = mail.replace("const OFFER_TEXT = '';", `const OFFER_TEXT = ${JSON.stringify(offer)};`); assert.notEqual(m, mail, 'OFFER_TEXT line not found'); mail = m; }
  vm.runInContext(mail, ctx);
  vm.runInContext(SRC.owner, ctx);
  return { run: (expr) => vm.runInContext(expr, ctx), calls, props: p, sheet, ctx };
}
const COLS = ['Timestamp', 'Full name', 'Company', 'Work email', 'Phone', 'Consent', 'Tablet', 'Score', 'Band', 'Product', 'Routed owner', 'Owner'];
const consentText = "I agree that Renfluence may contact me about this conversation. My details won't be shared with anyone else.";
// A new Form row, then the trigger Google fires for it.
const submit = (m, o = {}) => {
  const v = { Timestamp: '2026-11-10T09:00:00Z', 'Full name': 'Ana Silva', Company: 'Hotel Sol', 'Work email': 'ana@hotel.pt', Phone: '', Consent: consentText, Tablet: 'T1', Score: 80, Band: 'Hot', Product: 'Edge', 'Routed owner': 'Petros', Owner: '', ...o };
  m.sheet.g.push(COLS.map((c) => v[c] ?? ''));
  const row = m.sheet.g.length;
  m.run('onLeadSubmit')({ range: { getRow: () => row, getSheet: () => ({ getRange: (...a) => m.sheet.getRange(...a), getLastColumn: () => m.sheet.getLastColumn(), getSheetId: () => 7 }) } });
  return row;
};
const cfg = (o = {}) => ({ enabled: true, key: 'k', provider: 'resend', testTo: '', ...o });
const lead = (o = {}) => ({ key: 'k1', name: 'Ana Silva', firstName: 'Ana', email: 'ana@hotel.pt', consent: true, ...o });
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok: ' + name); };

// ---- the pure parts
const m0 = load();
const plan = (l, c) => plain(m0.run('plan_')(l, c));

ok('email validation: accepts one plain address, rejects lists, brackets, spaces and junk', () => {
  const v = m0.run('validAddress_');
  ['a@b.co', 'first.last+tag@sub.hotel.pt'].forEach((a) => assert.ok(v(a), a));
  ['', 'a@b', 'a b@c.com', 'a@x.com,b@y.com', 'a@x.com,b', 'a@x.com;b@y.com', '<a@b.com>', 'Ann <a@b.com>', 'a@@b.com', '"a"@b.com', 'a@b.com\n', 'a@b.c', null, undefined, 42, 'a'.repeat(250) + '@b.com']
    .forEach((a) => assert.ok(!v(a), String(a)));
});

ok('fill: first name is HTML-escaped, nothing {{ is left, the voucher block drops when empty', () => {
  const fill = m0.run('fill_');
  const html = '<p>{{first_name}}</p>\n<!-- voucher_line:start -->\n<td>{{voucher_line}}</td>\n<!-- voucher_line:end -->\n<p>end</p>';
  assert.equal(fill(html, { first_name: '<b>A&"', voucher_line: '' }, m0.run('esc_')), '<p>&lt;b&gt;A&amp;&quot;</p>\n<p>end</p>');
  assert.match(fill(html, { first_name: 'A', voucher_line: 'Code X' }, m0.run('esc_')), /<td>Code X<\/td>/);
  assert.equal(fill('a\n\n{{voucher_line}}\n\nb', { voucher_line: '' }), 'a\n\nb');
  assert.equal(fill('{{x}} {{first_name}}', { first_name: '$&' }), '{{x}} $&', 'a value with $ patterns is inserted literally');
});

ok('plan: off by default, no key, bad provider, bad email, no consent', () => {
  assert.equal(plan(lead(), cfg({ enabled: false })).reason, 'off');
  assert.equal(plan(lead(), cfg({ key: '' })).reason, 'no key');
  assert.equal(plan(lead(), cfg({ provider: 'sendgrid' })).reason, 'unknown provider');
  assert.equal(plan(lead({ email: 'a@b.com,c@d.com' }), cfg()).reason, 'invalid email');
  assert.equal(plan(lead({ consent: false }), cfg()).reason, 'no consent');
  assert.equal(m0.run('SEND_THANK_YOU'), false);
});

ok('plan: a real lead gets From, Reply-To, subject, first name and unsubscribe wording; no offer is invented', () => {
  const p = plan(lead({ firstName: '  Ana  ' }), cfg());
  assert.equal(p.send, true);
  assert.equal(p.to, 'ana@hotel.pt');
  assert.deepEqual(p.from, { name: 'Renfluence', email: 'info@renfluence.com' });
  assert.equal(p.replyTo, 'info@renfluence.com');
  assert.equal(p.subject, 'Thank you for visiting Renfluence at Web Summit');
  assert.equal(m0.run('DEFAULT_PROVIDER'), 'mailersend');
  assert.equal(m0.run('OFFER_TEXT'), '');
  for (const body of [p.text, p.html]) {
    assert.match(body, /Hi Ana,/);
    assert.match(body, /reply (&lsquo;|')no(&rsquo;|') and we will not write again/);
    assert.match(body, /info@renfluence\.com/);
    assert.ok(!/\{\{|\}\}|voucher_line|WEBSUMMIT26|50%|code /i.test(body), 'placeholder or invented offer left');
  }
  assert.ok(p.html.startsWith('<!DOCTYPE html>'));
  assert.ok(!/\n\n\n\n/.test(p.text), 'no big gap where the offer would be');
});

ok('plan: OFFER_TEXT, when the team sets it, appears in both versions (escaped in HTML)', () => {
  const m = load({ offer: 'Edge code <X> & more' });
  const p = plain(m.run('plan_')(lead(), cfg()));
  assert.match(p.text, /Edge code <X> & more/);
  assert.match(p.html, /Edge code &lt;X&gt; &amp; more/);
});

ok('plan: a missing first name reads "Hi there,"; a hostile one cannot inject HTML', () => {
  assert.match(plan(lead({ firstName: '' }), cfg()).text, /Hi there,/);
  const h = plan(lead({ firstName: '<script>alert(1)</script>' }), cfg()).html;
  assert.ok(!h.includes('<script>'));
});

ok('plan: TEST leads are skipped, unless TEST_TO is George, and then go to George only', () => {
  assert.equal(plan(lead({ name: 'TEST kiosk' }), cfg()).reason, 'test lead');
  assert.equal(plan(lead({ name: 'TEST kiosk' }), cfg({ testTo: 'someone@else.com' })).reason, 'test lead');
  const p = plan(lead({ name: 'TEST kiosk' }), cfg({ testTo: GEORGE }));
  assert.equal(p.to, GEORGE);
  assert.equal(plan(lead({ name: 'Tester Real' }), cfg({ testTo: GEORGE })).to, 'ana@hotel.pt', 'a real lead is never diverted');
});

ok('request: Resend and MailerSend shapes, the key only in the Authorization header', () => {
  const p = plan(lead(), cfg());
  const r = plain(m0.run('request_')(p, 'SECRET', 'idem-1'));
  assert.equal(r.url, 'https://api.resend.com/emails');
  assert.equal(r.headers.Authorization, 'Bearer SECRET');
  assert.equal(r.headers['Idempotency-Key'], 'idem-1');
  assert.deepEqual([r.body.from, r.body.to, r.body.reply_to], ['Renfluence <info@renfluence.com>', ['ana@hotel.pt'], 'info@renfluence.com']);
  const ms = plain(m0.run('request_')(plan(lead(), cfg({ provider: 'mailersend' })), 'SECRET', 'i'));
  assert.equal(ms.url, 'https://api.mailersend.com/v1/email');
  assert.deepEqual([ms.body.from.email, ms.body.to, ms.body.reply_to.email], ['info@renfluence.com', [{ email: 'ana@hotel.pt' }], 'info@renfluence.com']);
  [r, ms].forEach((x) => assert.ok(!JSON.stringify(x.body).includes('SECRET')));
});

// ---- idempotency
const memStore = (v = '') => { const s = { v, log: [], get: () => s.v, set: (x) => { s.v = x; s.log.push(x); } }; return s; };
const deps = (o = {}) => { const d = { store: memStore(), now: new Date('2026-11-10T10:00:00Z'), sent: [], send(p) { d.sent.push(p.to); }, count: () => 0, bump() { d.bumped = (d.bumped || 0) + 1; }, recent: () => false, remember(to) { d.remembered = to; }, ...o }; return d; };
const deliver = (l, c, d) => m0.run('deliver_')(l, c, d);

ok('deliver: sends once; a retry or re-run on the same row never sends again', () => {
  const d = deps();
  assert.equal(deliver(lead(), cfg(), d), 'sent');
  assert.equal(deliver(lead(), cfg(), d), 'already tried');
  assert.equal(deliver(lead(), cfg(), d), 'already tried');
  assert.equal(d.sent.length, 1);
  assert.match(d.store.v, /^sent 2026-11-10T10:00:00/);
});

ok('deliver: the marker says "sending" before the send happens, so a crash cannot cause a second email', () => {
  let seen;
  const d = deps(); d.send = () => { seen = d.store.v; };
  deliver(lead(), cfg(), d);
  assert.match(seen, /^sending /);
});

ok('deliver: a failed send is marked and not retried; a crash mid-send leaves "sending" and is not retried', () => {
  const d = deps(); d.send = () => { throw new Error('resend HTTP 500'); };
  assert.equal(deliver(lead(), cfg(), d), 'failed');
  assert.match(d.store.v, /^failed .*resend HTTP 500/);
  d.send = () => { throw new Error('must not run'); };
  assert.equal(deliver(lead(), cfg(), d), 'already tried');
  const crashed = deps({ store: memStore('sending 2026-11-10T10:00:00Z') });
  assert.equal(deliver(lead(), cfg(), crashed), 'already tried');
  assert.equal(crashed.sent.length, 0);
});

ok('deliver: nothing is written while off, a skip is marked once, the daily cap holds', () => {
  const off = deps(); assert.equal(deliver(lead(), cfg({ enabled: false }), off), 'skipped: off');
  assert.equal(off.store.log.length, 0);
  const nokey = deps(); deliver(lead(), cfg({ key: '' }), nokey);
  assert.equal(nokey.store.v, 'skipped: no key'); assert.equal(nokey.sent.length, 0);
  const capped = deps({ count: () => 300 });
  assert.equal(deliver(lead(), cfg(), capped), 'skipped: daily cap'); assert.equal(capped.sent.length, 0);
});

ok('deliver: the same address is mailed once per 6 hours, except George (so a test can be repeated)', () => {
  const d = deps({ recent: (to) => to === 'ana@hotel.pt' });
  assert.equal(deliver(lead(), cfg(), d), 'skipped: same address');
  assert.equal(d.sent.length, 0);
  assert.equal(d.store.v, 'skipped: same address within 6 hours');
  const g = deps({ recent: () => true });
  assert.equal(deliver(lead({ name: 'TEST x' }), cfg({ testTo: GEORGE }), g), 'sent');
  assert.equal(g.remembered, GEORGE);
});

ok('plan: the provider name is case-insensitive in config; leading space before TEST still counts as a test lead; an unknown API provider throws', () => {
  const m = load({ props: { EMAIL_PROVIDER: ' Resend ', EMAIL_PROVIDER_KEY: 'k' } });
  assert.equal(m.run('config_')().provider, 'resend');
  assert.equal(plan(lead({ name: ' TEST x' }), cfg()).reason, 'test lead');
  assert.throws(() => m0.run('request_')({ provider: 'gmail' }, 'k', 'i'), /no API/);
});

ok('mail_: the daily counter starts again on a new day and survives a corrupt value', () => {
  for (const TY_COUNT of ['2020-01-01:299', 'garbage', '']) {
    const m = load({ flag: true, props: { EMAIL_PROVIDER_KEY: 'k', TY_COUNT } });
    const store = memStore();
    assert.equal(m.run('mail_')(lead(), store), 'sent');
    assert.match(m.props.TY_COUNT, /^\d{4}-\d\d-\d\d:1$/);
  }
  const today = new Date().toISOString().slice(0, 10), full = load({ flag: true, props: { EMAIL_PROVIDER_KEY: 'k', TY_COUNT: today + ':300' } });
  assert.equal(full.run('mail_')(lead(), memStore()), 'skipped: daily cap');
  assert.equal(full.calls.fetch.length, 0);
});

// ---- the hook in onLeadSubmit
const mk = (o = {}) => load({ sheet: new FakeSheet([COLS.slice()]), ...o });
const MARKCOL = COLS.length;

ok('onLeadSubmit, flag off (as shipped): owner set, NO owner mail from this mailbox (notifyOwners in the info@ mailer does that), no extra column, the visitor is never contacted even with a key set', () => {
  const m = mk({ props: { EMAIL_PROVIDER_KEY: 'k' } });
  const row = submit(m);
  assert.equal(m.sheet.g[row - 1][COLS.indexOf('Owner')], 'Petros');
  assert.equal(m.calls.owner.length, 0, 'the capture script sends no owner mail');
  assert.equal(m.sheet.g[0].length, MARKCOL, 'no Thank-you sent header added');
  assert.deepEqual([m.calls.fetch.length, m.calls.gmail.length], [0, 0]);
});

ok('onLeadSubmit, flag on but no key: nothing sent, row marked "skipped: no key", still no owner mail', () => {
  const m = mk({ flag: true });
  const row = submit(m);
  assert.equal(m.calls.fetch.length, 0);
  assert.equal(m.calls.owner.length, 0);
  assert.equal(m.sheet.g[0][MARKCOL], 'Thank-you sent');
  assert.equal(m.sheet.g[row - 1][MARKCOL], 'skipped: no key');
});

ok('onLeadSubmit, flag on and key set: one MailerSend call per new row, marker "sent", a re-fired trigger sends nothing', () => {
  const m = mk({ flag: true, props: { EMAIL_PROVIDER_KEY: 'k' } });
  const row = submit(m);
  const again = { range: { getRow: () => row, getSheet: () => ({ getRange: (...a) => m.sheet.getRange(...a), getLastColumn: () => m.sheet.getLastColumn(), getSheetId: () => 7 }) } };
  m.run('onLeadSubmit')(again);
  assert.equal(m.calls.fetch.length, 1);
  const c = m.calls.fetch[0];
  assert.equal(c.url, 'https://api.mailersend.com/v1/email');
  assert.deepEqual([c.payload.from.email, c.payload.to, c.payload.reply_to.email], ['info@renfluence.com', [{ email: 'ana@hotel.pt' }], 'info@renfluence.com']);
  assert.match(c.payload.text, /Hi Ana,/);
  assert.match(m.sheet.g[row - 1][MARKCOL], /^sent /);
  assert.equal(m.sheet.g[0].length, MARKCOL + 1);
  submit(m, { 'Work email': 'bob@x.pt', 'Full name': 'Bob Jones' });
  assert.equal(m.calls.fetch.length, 2, 'the next lead is a new send');
});

ok('onLeadSubmit, flag on: no consent text, a bad email or a provider error never sends or breaks the lead', () => {
  const m = mk({ flag: true, props: { EMAIL_PROVIDER_KEY: 'k' } });
  const r1 = submit(m, { Consent: '' }), r2 = submit(m, { 'Work email': 'a@b.com, c@d.com' });
  assert.equal(m.calls.fetch.length, 0);
  assert.equal(m.sheet.g[r1 - 1][MARKCOL], 'skipped: no consent');
  assert.equal(m.sheet.g[r2 - 1][MARKCOL], 'skipped: invalid email');
  const bad = mk({ flag: true, props: { EMAIL_PROVIDER_KEY: 'k' }, status: 401 });
  const r3 = submit(bad);
  assert.match(bad.sheet.g[r3 - 1][MARKCOL], /^failed .*mailersend HTTP 401 nope/);
  assert.equal(bad.calls.owner.length, 0);
});

ok('onLeadSubmit, flag on: a TEST lead gets no owner mail, and mails only George when TEST_TO is his', () => {
  const m = mk({ flag: true, props: { EMAIL_PROVIDER_KEY: 'k' } });
  submit(m, { 'Full name': 'TEST Koulouris kiosk offline' });
  assert.equal(m.calls.owner.length, 0);
  assert.equal(m.calls.fetch.length, 0);
  const g = mk({ flag: true, props: { EMAIL_PROVIDER_KEY: 'k', TEST_TO: GEORGE } });
  submit(g, { 'Full name': 'TEST Koulouris kiosk offline', 'Work email': 'victim@example.com' });
  assert.deepEqual(g.calls.fetch.map((c) => c.payload.to), [[{ email: GEORGE }]]);
});

ok('onLeadSubmit, flag on, Gmail fallback: GmailApp sends from the info@ alias with Reply-To', () => {
  const m = mk({ flag: true, props: { EMAIL_PROVIDER_KEY: 'gmail', EMAIL_PROVIDER: 'gmail' } });
  submit(m);
  assert.equal(m.calls.fetch.length, 0);
  const [to, subject, text, o] = m.calls.gmail[0];
  assert.deepEqual([to, o.from, o.replyTo, o.name], ['ana@hotel.pt', 'info@renfluence.com', 'info@renfluence.com', 'Renfluence']);
  assert.match(text, /Hi Ana,/); assert.match(o.htmlBody, /<html/); assert.match(subject, /Thank you/);
});

ok('sendTestMail and dryRun: George only; the test mail refuses without a key; dryRun sends nothing', () => {
  assert.throws(() => load().run('sendTestMail')(), /EMAIL_PROVIDER_KEY/);
  const m = load({ props: { EMAIL_PROVIDER_KEY: 'k' } });
  m.run('sendTestMail')();
  assert.deepEqual(m.calls.fetch.map((c) => c.payload.to), [[{ email: GEORGE }]]);
  const d = mk({ props: { EMAIL_PROVIDER_KEY: 'k' } });
  submit(d);
  d.run('dryRun')();
  assert.equal(d.calls.fetch.length, 0);
});

ok('onLeadSubmit, flag on: the marker header is added once, "sending" is saved (flushed) before the provider is called, nothing logged as an error', () => {
  const m = mk({ flag: true, props: { EMAIL_PROVIDER_KEY: 'k' } });
  submit(m); submit(m, { 'Work email': 'bob@x.pt', 'Full name': 'Bob Jones' });
  assert.equal(m.sheet.g[0].filter((h) => h === 'Thank-you sent').length, 1);
  assert.ok(m.calls.fetch[0].flushes > 0, 'no flush before the fetch');
  assert.match(m.calls.fetch[0].sheetThen, /sending 20/);
  assert.deepEqual(m.calls.errors, []);
});

ok('onLeadSubmit, flag on: the same address twice in a row is mailed once; the Idempotency key is per submission', () => {
  const m = mk({ flag: true, props: { EMAIL_PROVIDER_KEY: 'k', EMAIL_PROVIDER: 'resend' } });
  const r1 = submit(m), r2 = submit(m, { Timestamp: '2026-11-10T09:05:00Z' });
  assert.equal(m.calls.fetch.length, 1);
  assert.equal(m.sheet.g[r2 - 1][MARKCOL], 'skipped: same address within 6 hours');
  assert.equal(m.calls.fetch[0].headers['Idempotency-Key'], 'SHEETID-2-2026-11-10T09:00:00Z');
  assert.equal(r1, 2);
});

ok('dryRun: logs the switches, the sample text and one decision per row, with no name or address of a visitor; an empty Sheet does not throw', () => {
  const d = mk({ props: { EMAIL_PROVIDER_KEY: 'k' } });
  submit(d); submit(d, { Consent: '', 'Full name': 'Bob Jones', 'Work email': 'bob@x.pt' });
  d.run('dryRun')();
  const out = d.calls.log.join('\n');
  assert.match(out, /SEND_THANK_YOU=false, key set=true, provider=mailersend/);
  assert.match(out, /from Renfluence <info@renfluence\.com>/);
  assert.match(out, /row 2: would send/); assert.match(out, /row 3: would skip: no consent/);
  assert.ok(!/ana@hotel|Ana Silva|bob@x/.test(out));
  assert.doesNotThrow(() => load({ sheet: new FakeSheet() }).run('dryRun')());
});

console.log('PASS (' + n + ' checks)');
