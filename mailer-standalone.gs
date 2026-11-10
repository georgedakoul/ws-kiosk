// Standalone thank-you mailer for Renfluence. Its own Apps Script project, owned by info@renfluence.com: it reads the leads Sheet by id and sends from that mailbox with GmailApp.
// It does not touch the kiosk, the Form or the capture script. LIVE: SEND_THANK_YOU is true and a 5-minute trigger runs sendPending (see mailer-standalone-README.md). Off: set it to false and run removeTrigger.
// Per row without a «Thank-you sent» marker: validate the address, write the marker BEFORE sending, send, write the result. Never twice, and a failed send is not retried.
// Editor functions: dryRun() (logs what would be sent per row, row numbers only, sends nothing), sendTestMail() (one mail to GEORGE only), installTrigger() / removeTrigger() (every 5 minutes).
// The pure parts (plan_, deliver_, fill_, validAddress_, leadOf_) are checked by mailer-check.mjs.
const SEND_THANK_YOU = true;
const SHEET_ID = '1gL3qWTlDSQkDGJT86B1mW1s3vtEy46-YD_zRfXsbxJE'; // Web Summit 2026 leads (the Form responses Sheet); this account needs Editor access (the marker column is written there)
const FIRST_ROW = 8; // rows above this are never mailed (rows 2 to 7 are test rows from 5 Nov, junk names that do not start with TEST). Check it against dryRun() before switching on
const SENDER = { name: 'Renfluence', email: 'info@renfluence.com' }; // the script must run as this account, see assertSender_
const SUBJECT = 'Thank you for visiting Renfluence at Web Summit';
const OFFER_TEXT = ''; // NOT set: no offer is confirmed for Renfluence yet (does the Edge code work? George or Karavokyris to confirm)
const POSTAL_ADDRESS = ''; // company address for the footer; empty drops it
const GEORGE = 'george.koulouris@renfluence.com'; // the only address a TEST lead or the test mail can reach
const MARK = 'Thank-you sent'; // Sheet column, added at the right on the first real send. Empty = never tried; anything else = tried once, never again
const DAILY_CAP = 300; // thank-yous per day (Workspace allows 1500 recipients a day)
const PER_RUN = 40; // rows per run, well inside Apps Script's 6 minutes

const TEXT = `Hi {{first_name}},

Thanks for stopping by our booth at Web Summit Lisbon (Pavilion 1, A2-69). If you want to continue the conversation, just reply to this email, it goes straight to our team.

{{voucher_line}}

What we do
Renfluence finds the right creators for brands by looking inside their videos.
Edge is our analytics product.

Thanks again,
The Renfluence team
https://www.renfluence.ai/en/?utm_source=email&utm_medium=thankyou&utm_campaign=websummit

--
If this is not for you, reply 'no' and we will not write again.
Renfluence · info@renfluence.com{{postal_address}}
`;

const HTML = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Renfluence at Web Summit Lisbon</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>table, td, div, p, a { font-family: Arial, Helvetica, sans-serif !important; }</style>
<![endif]-->
<style>
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse; mso-table-lspace: 0; mso-table-rspace: 0; }
  img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  a { color: #0047FF; }
  @media only screen and (max-width: 620px) {
    .pad { padding-left: 22px !important; padding-right: 22px !important; }
    .h1 { font-size: 26px !important; line-height: 32px !important; }
    .btn-td { display: block !important; width: 100% !important; }
    .btn-a { display: block !important; padding-left: 12px !important; padding-right: 12px !important; }
    .outer-pad { padding: 18px 10px !important; }
  }
  /* darkproof */
  :root { color-scheme: light only; supported-color-schemes: light only; }
  @media (prefers-color-scheme: dark) {
  .bgc-0047ff { background-color: #0047ff !important; background-image: linear-gradient(#0047ff,#0047ff) !important; }
  .bgc-ffffff { background-color: #ffffff !important; background-image: linear-gradient(#ffffff,#ffffff) !important; }
  .bgc-00f1ff { background-color: #00f1ff !important; background-image: linear-gradient(#00f1ff,#00f1ff) !important; }
  .bgc-eef3ff { background-color: #eef3ff !important; background-image: linear-gradient(#eef3ff,#eef3ff) !important; }
  .c-0047ff { color: #0047ff !important; }
  .c-0d1830 { color: #0d1830 !important; }
  .c-ffffff { color: #ffffff !important; }
  .c-46536f { color: #46536f !important; }
  .bd-0047ff { border-color: #0047ff !important; }
  }
  [data-ogsb] .bgc-0047ff { background-color: #0047ff !important; background-image: linear-gradient(#0047ff,#0047ff) !important; }
  [data-ogsb] .bgc-ffffff { background-color: #ffffff !important; background-image: linear-gradient(#ffffff,#ffffff) !important; }
  [data-ogsb] .bgc-00f1ff { background-color: #00f1ff !important; background-image: linear-gradient(#00f1ff,#00f1ff) !important; }
  [data-ogsb] .bgc-eef3ff { background-color: #eef3ff !important; background-image: linear-gradient(#eef3ff,#eef3ff) !important; }
  [data-ogsc] .c-0047ff { color: #0047ff !important; }
  [data-ogsc] .c-0d1830 { color: #0d1830 !important; }
  [data-ogsc] .c-ffffff { color: #ffffff !important; }
  [data-ogsc] .c-46536f { color: #46536f !important; }
  [data-ogsc] .bd-0047ff { border-color: #0047ff !important; }
</style>
</head>
<body style="margin:0; padding:0; background-color:#0047FF; background-image:linear-gradient(#0047FF,#0047FF);" class="bgc-0047ff">

<!-- preheader: the grey preview line in the inbox -->
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#0047FF;" class="c-0047ff">
  Thanks for visiting Renfluence at Web Summit Lisbon.&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;
</div>

<!-- Background: solid brand blue (bgcolor) always shows. The pattern is an extra that Gmail and Apple Mail draw, Outlook desktop skips. -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0047FF" background="https://georgedakoul.github.io/ws-kiosk/email-pattern.png" style="background-color:#0047FF; background-image:url('https://georgedakoul.github.io/ws-kiosk/email-pattern.png'),linear-gradient(#0047FF,#0047FF); background-repeat:repeat;" class="bgc-0047ff">
  <tr>
    <td align="center" class="outer-pad" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;">

        <!-- header: white logo on the blue background -->
        <tr>
          <td align="left" class="pad" style="padding:4px 8px 22px 8px;">
            <a href="https://www.renfluence.ai/en/?utm_source=email&amp;utm_medium=thankyou&amp;utm_campaign=websummit" target="_blank" style="text-decoration:none;"><img src="https://georgedakoul.github.io/ws-kiosk/logo-white.png" width="160" height="43" alt="Renfluence" style="display:block; width:160px; height:auto; font-family:Arial, Helvetica, sans-serif; font-size:22px; font-weight:bold; color:#FFFFFF;"></a>
          </td>
        </tr>

        <!-- card -->
        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF; border-radius:16px; background-image:linear-gradient(#FFFFFF,#FFFFFF);" class="bgc-ffffff">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

              <!-- accent bar -->
              <tr><td height="6" bgcolor="#00F1FF" style="height:6px; line-height:6px; font-size:0; background-color:#00F1FF; border-radius:16px 16px 0 0; background-image:linear-gradient(#00F1FF,#00F1FF);" class="bgc-00f1ff">&nbsp;</td></tr>

              <!-- eyebrow + greeting -->
              <tr>
                <td class="pad c-0047ff" style="padding:36px 40px 0 40px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:13px; line-height:18px; font-weight:bold; letter-spacing:1.2px; text-transform:uppercase; color:#0047FF;">
                  Web Summit Lisbon &middot; 10 to 12 Nov
                </td>
              </tr>
              <tr>
                <td class="pad h1 c-0d1830" style="padding:10px 40px 0 40px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:32px; line-height:38px; font-weight:bold; letter-spacing:-0.5px; color:#0D1830;">
                  Hi {{first_name}}, thanks for stopping by.
                </td>
              </tr>

              <!-- human intro -->
              <tr>
                <td class="pad c-0d1830" style="padding:18px 40px 0 40px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:16px; line-height:25px; color:#0D1830;">
                  It was good to meet you at our booth (Pavilion 1, A2-69) at Web Summit Lisbon. If you want to continue the conversation, just reply to this email, it goes straight to our team.
                </td>
              </tr>

              
              <!-- the one call to action -->
              <tr>
                <td class="pad" align="left" style="padding:28px 40px 0 40px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td class="btn-td bgc-0047ff" align="center" bgcolor="#0047FF" style="border-radius:12px; background-color:#0047FF; background-image:linear-gradient(#0047FF,#0047FF);">
                        <!--[if mso]>
                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="https://www.renfluence.ai/en/?utm_source=email&amp;utm_medium=thankyou&amp;utm_campaign=websummit" style="height:54px; v-text-anchor:middle; width:520px;" arcsize="22%" stroke="f" fillcolor="#0047FF"><w:anchorlock xmlns:w="urn:schemas-microsoft-com:office:word"/><center style="color:#FFFFFF; font-family:Arial, sans-serif; font-size:17px; font-weight:bold;">Visit renfluence.com</center></v:roundrect>
                        <![endif]-->
                        <!--[if !mso]><!-->
                        <a class="btn-a bgc-0047ff c-ffffff" href="https://www.renfluence.ai/en/?utm_source=email&amp;utm_medium=thankyou&amp;utm_campaign=websummit" target="_blank" style="display:inline-block; padding:16px 32px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:17px; line-height:22px; font-weight:bold; color:#FFFFFF; text-decoration:none; border-radius:12px; background-color:#0047FF; background-image:linear-gradient(#0047FF,#0047FF);">Visit renfluence.com</a>
                        <!--<![endif]-->
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
              <!-- voucher_line:start -->
              <tr>
                <td class="pad" style="padding:24px 40px 0 40px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                    <tr>
                      <td bgcolor="#FFFFFF" style="background-color:#FFFFFF; border:2px solid #0047FF; border-radius:10px; padding:14px 18px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:15px; line-height:23px; font-weight:bold; color:#0D1830; background-image:linear-gradient(#FFFFFF,#FFFFFF);" class="bgc-ffffff c-0d1830 bd-0047ff">
                        {{voucher_line}}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- voucher_line:end -->

              <!-- what we do -->
              <tr>
                <td class="pad" style="padding:32px 40px 0 40px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td bgcolor="#EEF3FF" style="background-color:#EEF3FF; border-left:4px solid #0047FF; border-radius:10px; padding:18px 20px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:15px; line-height:23px; color:#0D1830; background-image:linear-gradient(#EEF3FF,#EEF3FF);" class="bgc-eef3ff c-0d1830 bd-0047ff">
                        <strong style="color:#0047FF; font-size:12px; letter-spacing:1.2px; text-transform:uppercase;" class="c-0047ff">What we do</strong><br>
                        Renfluence finds the right creators for brands by looking inside their videos.<br>
                        Edge is our analytics product.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- sign-off -->
              <tr>
                <td class="pad c-0d1830" style="padding:30px 40px 0 40px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:16px; line-height:25px; color:#0D1830;">
                  Thanks again,
                </td>
              </tr>
              <tr>
                <td class="pad c-0d1830" style="padding:6px 40px 40px 40px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:16px; line-height:22px; color:#0D1830;">
                  <strong>The Renfluence team</strong><br>
                  <a href="https://www.renfluence.ai/en/?utm_source=email&amp;utm_medium=thankyou&amp;utm_campaign=websummit" target="_blank" style="color:#46536F; font-size:14px; text-decoration:underline;" class="c-46536f">renfluence.com</a>
                </td>
              </tr>

            </table>
          </td>
        </tr>

        <!-- footer, on the blue background -->
        <tr>
          <td class="pad c-ffffff" align="left" style="padding:22px 8px 0 8px; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:13px; line-height:20px; color:#FFFFFF;">
            If this is not for you, reply &lsquo;no&rsquo; and we will not write again.<br>
            Renfluence &middot; info@renfluence.com{{postal_address}}
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>

</body>
</html>
`;

const validAddress_ = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>,;"()\[\]\\]+@[^\s@<>,;"()\[\]\\]+\.[^\s@<>,;"()\[\]\\]{2,}$/.test(s);
const esc_ = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Fills {{placeholders}}. An empty value also drops its <!-- name:start --> ... <!-- name:end --> block (HTML) or its line plus the blank after it (text).
function fill_(tpl, vars, escape) {
  let t = tpl;
  Object.keys(vars).filter((k) => !vars[k]).forEach((k) => {
    t = t.replace(new RegExp('[ \\t]*<!-- ' + k + ':start -->[\\s\\S]*?<!-- ' + k + ':end -->\\n?'), '').split('{{' + k + '}}\n\n').join('');
  });
  return t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? (escape ? escape(vars[k]) : vars[k]) : m));
}


// A row as plan_ wants it. Consent: the Form's required checkbox leaves its text in «Consent»; a row without it gets no email.
const leadOf_ = (at) => { const name = at('Full name').trim(); return { name, firstName: name.split(/\s+/)[0], email: at('Work email').trim(), consent: !!at('Consent').trim() }; };

// What would be sent, or why nothing is. Pure. testTo = Script Property TEST_TO.
function plan_(lead, testTo) {
  const no = (reason) => ({ send: false, reason });
  if (!validAddress_(lead.email)) return no('invalid email');
  if (!lead.consent) return no('no consent');
  let to = lead.email;
  if (String(lead.name).trim().startsWith('TEST')) { // a test lead never reaches a visitor's inbox: only George, and only when TEST_TO is his address
    if (testTo !== GEORGE) return no('test lead');
    to = GEORGE;
  }
  const vars = { first_name: String(lead.firstName || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'there', voucher_line: OFFER_TEXT, postal_address: POSTAL_ADDRESS ? ' · ' + POSTAL_ADDRESS : '' };
  return { send: true, to, subject: SUBJECT, text: fill_(TEXT, vars), html: fill_(HTML, vars, esc_) };
}

// Tries once, never twice. deps = { store: { get, set } (the row's marker), count, bump, recent, remember (address mailed in the last 6 hours), send(plan), now }.
// The marker is written BEFORE the send, so a crash or a re-run can cost a missing email but never a second one.
function deliver_(lead, testTo, deps) {
  if (deps.store.get()) return 'already tried';
  const p = plan_(lead, testTo);
  if (!p.send) { deps.store.set('skipped: ' + p.reason); return 'skipped: ' + p.reason; }
  if (deps.count() >= DAILY_CAP) return 'daily cap reached, left for the next run'; // no marker: tomorrow's run still sends it
  if (p.to !== GEORGE && deps.recent(p.to)) { deps.store.set('skipped: same address within 6 hours'); return 'skipped: same address'; }
  const stamp = deps.now.toISOString();
  deps.store.set('sending ' + stamp);
  deps.remember(p.to);
  try {
    deps.send(p);
    deps.bump();
    deps.store.set('sent ' + stamp);
    return 'sent';
  } catch (err) {
    deps.store.set('failed ' + stamp + ': ' + String(err && err.message || err).slice(0, 100));
    return 'failed';
  }
}

const send_ = (p) => GmailApp.sendEmail(p.to, p.subject, p.text, { htmlBody: p.html, name: SENDER.name, replyTo: SENDER.email });
const testTo_ = () => (PropertiesService.getScriptProperties().getProperty('TEST_TO') || '').trim();

// A copy of this project under another account would send as that account: stop.
function assertSender_() {
  const me = Session.getEffectiveUser().getEmail();
  if (me.toLowerCase() !== SENDER.email) throw new Error('Runs as ' + me + ', not ' + SENDER.email + ': nothing sent.');
}

function sheet_() { return SpreadsheetApp.openById(SHEET_ID).getSheets()[0]; }
const heads_ = (sh) => sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((h) => String(h).trim());

// Every row from FIRST_ROW as { row, marker, lead }. marker is '' while the column does not exist yet.
function rows_(sh) {
  const heads = heads_(sh), last = sh.getLastRow();
  if (last < FIRST_ROW) return [];
  const m = heads.indexOf(MARK);
  return sh.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, heads.length).getValues().map((r, i) => ({ row: FIRST_ROW + i, marker: m < 0 ? '' : String(r[m]).trim(),
    lead: leadOf_((h) => (heads.includes(h) ? String(r[heads.indexOf(h)]) : '')) }));
}

// The time trigger runs this. With SEND_THANK_YOU false it does nothing.
function sendPending() {
  if (SEND_THANK_YOU !== true) { console.log('SEND_THANK_YOU is false: nothing sent'); return; }
  assertSender_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log('another run is busy'); return; }
  try {
    const sh = sheet_(), props = PropertiesService.getScriptProperties(), cache = CacheService.getScriptCache(), testTo = testTo_(), todo = rows_(sh).filter((r) => !r.marker).slice(0, PER_RUN);
    if (!todo.length) return;
    let c = heads_(sh).indexOf(MARK) + 1;
    if (!c) { c = sh.getLastColumn() + 1; sh.getRange(1, c).setValue(MARK).setFontWeight('bold'); }
    const day = new Date().toISOString().slice(0, 10), seen = (to) => 'ty:' + to.toLowerCase(); // the script cache keeps an entry 6 hours at most
    const counter = () => { const [d, n] = (props.getProperty('TY_COUNT') || '').split(':'); return d === day ? Number(n) || 0 : 0; };
    todo.forEach((r) => {
      const cell = sh.getRange(r.row, c);
      const res = deliver_(r.lead, testTo, { now: new Date(), send: send_, count: counter, bump: () => props.setProperty('TY_COUNT', day + ':' + (counter() + 1)),
        recent: (to) => !!cache.get(seen(to)), remember: (to) => cache.put(seen(to), '1', 21600),
        store: { get: () => String(cell.getValue()), set: (v) => { cell.setValue(v); SpreadsheetApp.flush(); } } }); // flush: "sending" must be saved before the mail goes
      console.log('row ' + r.row + ': ' + res);
    });
  } finally {
    lock.releaseLock();
  }
}

// In the editor: one real email to GEORGE only, to check the sender and how it looks. Ignores SEND_THANK_YOU; marks nothing; needs no Sheet.
function sendTestMail() {
  assertSender_();
  const p = plan_({ name: 'George Koulouris', firstName: 'George', email: GEORGE, consent: true }, '');
  send_(p);
  console.log('test mail sent to ' + GEORGE + ' from ' + SENDER.email);
}

// In the editor: logs what would be sent and sends nothing: the switches, the sample message, then the decision per row (row numbers only, no names or addresses).
function dryRun() {
  const testTo = testTo_(), sample = plan_({ name: 'Sample Visitor', firstName: 'Sam', email: GEORGE, consent: true }, testTo);
  console.log('SEND_THANK_YOU=' + SEND_THANK_YOU + ', runs as ' + Session.getEffectiveUser().getEmail() + ', from ' + SENDER.name + ' <' + SENDER.email + '>, reply-to ' + SENDER.email + ', TEST_TO ' + (testTo === GEORGE ? 'set' : 'not set') + ', first row ' + FIRST_ROW);
  console.log('subject "' + sample.subject + '"\n--- text ---\n' + sample.text);
  const tally = {};
  rows_(sheet_()).forEach((r) => {
    const p = plan_(r.lead, testTo), what = r.marker ? 'already ' + r.marker.split(' ')[0] : p.send ? 'would send' : 'would skip: ' + p.reason;
    console.log('row ' + r.row + ': ' + what);
    tally[what] = (tally[what] || 0) + 1;
  });
  console.log('summary: ' + JSON.stringify(tally));
}

function installTrigger() { removeTrigger(); ScriptApp.newTrigger('sendPending').timeBased().everyMinutes(5).create(); }
function removeTrigger() { ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'sendPending').forEach((t) => ScriptApp.deleteTrigger(t)); }
