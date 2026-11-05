// Bound to the Sheet "Web Summit 2026 leads" (Extensions, Apps Script). Run install() once as
// george.koulouris@renfluence.com: the onFormSubmit trigger then runs, and sends mail, as that account.
// On each new lead: set Owner to the Routed owner if Owner is empty, then email that owner.
const OWNER_EMAIL = {
  'Petros': 'petros@renfluence.com',
  'Panagiotis': 'panagiotis@renfluence.com',
  'George Karavokyris': 'george@renfluence.com',
  'George Koulouris': 'george.koulouris@renfluence.com',
};

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
  const owner = String(get('Owner')) || (routed in OWNER_EMAIL ? routed : 'Petros');
  if (!get('Owner')) sh.getRange(row, col['Owner']).setValue(owner);

  const lead = {
    name: String(get('Full name')), company: String(get('Company')), email: String(get('Work email')), phone: String(get('Phone')),
    band: String(get('Band')), product: String(get('Product')), score: get('Score'), tablet: String(get('Tablet')),
    time: Utilities.formatDate(new Date(get('Timestamp')), 'Europe/Athens', 'yyyy-MM-dd HH:mm'),
    link: `${SpreadsheetApp.getActive().getUrl()}#gid=${sh.getSheetId()}&range=A${row}`,
  };
  // Test leads set Owner but send no mail. Mail goes only to a team address, never to the visitor.
  if (lead.name.startsWith('TEST')) return;
  try { sendLead_(lead, OWNER_EMAIL[owner]); } catch (err) { console.error('mail failed: ' + err); }
}

function sendLead_(l, to) {
  MailApp.sendEmail(to, `Νέο lead Web Summit: ${l.name}, ${l.company} (${l.band})`, [
    `Name: ${l.name}`, `Company: ${l.company}`, `Email: ${l.email}`, `Phone: ${l.phone || '-'}`,
    `Product: ${l.product}`, `Score: ${l.score} (${l.band})`, `Tablet: ${l.tablet || '-'}`, `Time: ${l.time}`, '', `Sheet row: ${l.link}`,
  ].join('\n'));
}

// One mail to George only, to check that sending works.
function testMail() {
  sendLead_({ name: 'TEST Koulouris', company: 'TEST', email: 'test@example.com', phone: '', band: 'Hot', product: 'Edge', score: 80,
    tablet: 'TEST', time: Utilities.formatDate(new Date(), 'Europe/Athens', 'yyyy-MM-dd HH:mm'), link: SpreadsheetApp.getActive().getUrl() }, 'george.koulouris@renfluence.com');
}
