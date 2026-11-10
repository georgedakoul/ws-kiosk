// Bound to the Sheet "Web Summit 2026 leads" (Extensions, Apps Script). Run install() once as
// george.koulouris@renfluence.com: the onFormSubmit trigger then runs as that account.
// On each new lead: set Owner to the Routed owner if Owner is empty. It sends NO mail: the owner notification is notifyOwners() in the
// standalone mailer (mailer-standalone.gs, runs as info@renfluence.com), so nothing leaves George's mailbox. thank-you.gs (second file of this
// project) can also email the visitor; it is off, see there.
const OWNERS = ['Petros', 'Panagiotis', 'George Karavokyris', 'George Koulouris']; // the addresses live in mailer-standalone.gs (OWNER_EMAIL)

function install() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'onLeadSubmit').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onLeadSubmit').forSpreadsheet(SpreadsheetApp.getActive()).onFormSubmit().create();
}

function onLeadSubmit(e) {
  const sh = e.range.getSheet(), row = e.range.getRow();
  const col = {};
  sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].forEach((h, i) => { if (h && !(h in col)) col[h] = i + 1; });
  const get = (h) => (col[h] ? sh.getRange(row, col[h]).getValue() : '');
  // The Score, Band, Product and Routed owner formulas calculate just after the row lands.
  let routed = '';
  for (let i = 0; i < 10 && !routed; i++) {
    SpreadsheetApp.flush();
    routed = String(get('Routed owner'));
    if (!routed) Utilities.sleep(1000);
  }
  // "Check with Petros" and anything unknown go to Petros.
  if (!get('Owner')) sh.getRange(row, col['Owner']).setValue(OWNERS.includes(routed) ? routed : 'Petros');
  // Test leads get an Owner like any other. The owner mail (mailer-standalone.gs, notifyOwners) skips names starting with TEST.
  // The visitor's thank-you (thank-you.gs): off unless SEND_THANK_YOU and the key are set. A failure here must not stop anything else.
  if (SEND_THANK_YOU) try { thankYouRow_(sh, row, get, String(get('Full name')), String(get('Work email'))); } catch (err) { console.error('thank-you step failed, row ' + row + ': ' + err); }
}

// Lead as thank-you.gs wants it. consent: the Form's required checkbox leaves its text in «Consent»; a row without it gets no email.
const leadOf_ = (key, name, email, consent) => ({ key, name, firstName: name.trim().split(/\s+/)[0], email: email.trim(), consent: !!String(consent).trim() });

// One send per row, under the script lock because two tablets can submit at once. The marker column is added at the right on first use.
// ponytail: the provider call runs inside this lock (30 s wait); a lock timeout loses that one thank-you, never the lead.
function thankYouRow_(sh, row, get, name, email) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // The marker column is looked up inside the lock: a second tablet may have added it since `col` was read.
    const heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((h) => String(h).trim());
    let c = heads.indexOf(MARK) + 1;
    if (!c) { c = heads.length + 1; sh.getRange(1, c).setValue(MARK).setFontWeight('bold'); }
    const cell = sh.getRange(row, c), key = [SpreadsheetApp.getActive().getId(), row, get('Timestamp')].join('-'); // per submission, stable when rows move
    return mail_(leadOf_(key, name, email, get('Consent')), { get: () => String(cell.getValue()), set: (v) => { cell.setValue(v); SpreadsheetApp.flush(); } }); // flush: "sending" must be saved before the provider is called
  } finally {
    lock.releaseLock();
  }
}

// The last 3 rows as dryRun (thank-you.gs) wants them.
function recentLeads_() {
  const sh = SpreadsheetApp.getActive().getSheets()[0], last = sh.getLastRow();
  if (last < 2) return [];
  const heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  const first = Math.max(2, last - 2), at = (r, h) => (heads.includes(h) ? String(r[heads.indexOf(h)]) : '');
  return sh.getRange(first, 1, last - first + 1, heads.length).getValues().map((r, i) => ({ row: first + i, marker: at(r, MARK),
    lead: leadOf_('dry-' + (first + i), at(r, 'Full name'), at(r, 'Work email'), at(r, 'Consent')) }));
}
