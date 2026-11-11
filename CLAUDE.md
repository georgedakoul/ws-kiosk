# ws-kiosk

The Renfluence lead form for the Web Summit Lisbon 2026 booth tablet (Redmi Pad 2, Chrome).
One static `index.html`, no build, served by GitHub Pages at https://georgedakoul.github.io/ws-kiosk/.

- It posts each answer set to the Google Form "Web Summit 2026 kiosk form" (`formResponse`, `no-cors`).
  The Sheet "Web Summit 2026 leads" behind it computes score, band, product and owner.
- The `entry.NNN` ids and section numbers (`pageHistory`) come from the form's `FB_PUBLIC_LOAD_DATA_`.
  Editing the form's questions or options breaks the mapping: re-read them and update `index.html`.
- The questions, Q7 rule, thank-you lines and timers follow Petros's doc
  "Lisbon kiosk: qualification questionnaire".
- No analytics, no third-party scripts, no fonts from a CDN.

## Wording lives in a Sheet

- Panagiotis and Petros edit the wording in the Sheet «Kiosk κείμενα» (tab `Texts`, columns `key | text | note`,
  https://docs.google.com/spreadsheets/d/1GIlCsNbtw3rxXuhz70V5ooyr3SAF2ut_uz3GOhQArBg/edit). It holds only texts,
  shared "anyone with the link: viewer", editors inherited from the team folder. The leads Sheet stays private.
- The page fetches the tab as CSV (`/gviz/tq?tqx=out:csv&sheet=Texts`) at load and every 5 minutes. Built-in text is the
  fallback: fetch fails, blank cell, unknown key, or a non-CSV reply. The last good copy is cached in `ws-kiosk-texts`.
  New text is applied only on the welcome screen (`adopt()` inside `show('welcome')`), never mid-visitor.
- Every visible string is a key: static HTML carries `data-t="key"`, the rest comes from `QUESTIONS`, `VOLUME_QUESTIONS`
  and `DEF`. A new key needs a row in the Sheet (the built-in text is its default).
- Editing wording never changes what is posted: options post their original `v` (Form value), looked up by option key `k`,
  and the consent post is always the original `CONSENT`. Adding or removing a question or option is a code change.
- Q4 «Other in Europe» and «Elsewhere» each open their own list and a «Which market?» field on the same screen (`q.more.groups`).
  Both post as one answer to the extra Form question «Other markets» (`entry.496172218`, optional, same section as Q4), list then
  text per open group, comma-joined, never to Q4's own checkbox, so the Sheet's scoring still reads Q4 as before. In the leads
  Sheet the column sits after «Tablet» and before «Score».
- **Leads Sheet layout (reordered by Petros, 11 Nov; checked live with a TEST lead the same day).** Tab Leads, A to AD: A Full name, B What is your
  role?, C Company, D Work email, E Product (formula), F Timestamp, G..W the remaining answers in Form order (G Q1, H Q3, I Q4, J Q5, K Q6, L Which
  platform?, M..O the three Q7 wordings, P Q8, Q Phone, R Consent, S Tablet, T Other markets, U Q1 other text, V Q2 other text, W Spoke with), then
  X Score, Y Band, Z Routed owner (formulas), AA Owner, AB Status, AC Note, AD Thank-you sent. The Form writes into the same header names, so the mapping
  holds; the formulas read F for the timestamp. **Timestamp is no longer column A**: scripts must find columns by header, never by position (the
  `index.html` `COLUMNS` order, so the archive and CSV, is still the Form's old order with Timestamp first, and does not match the Sheet). The Form
  writes into the first empty row, so rows added by hand without a timestamp (the name-only rows under the live leads) sit between submissions. Open: `notifyOwners` in `mailer-standalone.gs` still takes column A (`r[0]`) as the timestamp, so after the reorder it counts name-only rows as leads.
- Q1 and Q2 «Something else» open an optional text field (`ask`). The Form's «Something else» is a plain option with no free-text
  response, so the typed text posts to two extra optional short-answer Form questions at the end of the details section, «Q1 other text»
  (`entry.415824857`) and «Q2 other text» (`entry.1228148969`). Q1 and Q2 themselves still post only their option. In the leads Sheet
  they sit after «Other markets» and before «Score» (the archive and CSV use the same order). The Form keeps a column for a deleted
  question, so never delete and re-add a Form question: the Sheet gets a dead duplicate column.

## Never lose a lead

- Every submitted lead is appended to `localStorage` `ws-kiosk-archive` (timestamp with the Athens offset,
  device, answers by question, the posted body, sent time) before the thank-you shows, and never removed.
- `?export` (team only, never linked from the kiosk flow): counts, **Download CSV** (UTF-8 BOM, Sheet column
  order, formula-looking text prefixed with `'`), **Retry sending now**, and the field «Όνομα tablet».
- The device name is stored in `ws-kiosk-device`, shown small on the welcome screen (amber «Tablet: not set»),
  and posted as the Form question «Tablet» (`entry.938892717`, short answer, not required, never shown to visitors).
- `navigator.storage.persist()` is requested. If `localStorage` fails, a red banner shows on the welcome screen
  and leads stay in memory for that page.
- There is no idle timeout: a visitor's answers stay on screen until they submit or tap Back, however long the tablet sits (an idle reset lost answers). Only the thank-you screen returns to the welcome screen by itself, after 25 s (`?thanks=N` shortens it), because its lead is already archived.
- The reset after the thank-you is a deadline checked four times a second (and on visibility, focus, pageshow),
  so a throttled tablet still resets. **Next visitor** resets at once.
- Details screen: «Who did you speak with at our booth?» (`who`, `#f-who`) sits after the email field: five `.opt` buttons (Petros, Panagiotis,
  Giorgos, Karavokyris, Theo), optional, one choice, tap again to deselect, wording keys `who` and `who.<name>`. It posts the fixed name (`data-w`)
  to the Form's last question «Spoke with» (short answer, `entry.1189592180`, details section, so `pageHistory` is unchanged); untouched posts
  nothing. In the leads Sheet it is column W (after «Q2 other text», before «Score»); the archive and CSV keep the Form's order (see the Sheet layout bullet). The Form puts a new
  question's column before the formula columns, which follow it (checked: Score, Band, Product, Routed owner formulas and values unchanged).
- `sheet-owner.gs` is the Apps Script bound to the Sheet. `install()` creates the `onFormSubmit` trigger: it sets Owner from Routed owner when
  empty and sends **no mail**. The owner notification is `notifyOwners()` in the info@ mailer («Thank-you mailer (live)» below), so nothing
  leaves George's mailbox. The live bound project is the older single-file version (no `thank-you.gs`, no `SEND_THANK_YOU`): never paste this
  repo file over it, delete the lead object, `sendLead_` and `testMail` from the live `onLeadSubmit` instead (steps in the 10 Nov commit message).
  **Live state 10 Nov: the old owner mail from George's account is still live until `notifyOwners()` runs in the info@ project** (no browser session
  on the box owns that project), then remove it. Names starting with `TEST` get an Owner and no owner mail.
- The in-project `thank-you.gs` is the old path and stays off; the live mailer is the standalone project in «Thank-you mailer (live)» below. It is the **second file** of that Apps Script project (paste both; `sheet-owner.gs` alone fails on the missing constants) and can mail
  the visitor. Off twice: `SEND_THANK_YOU = false` and no Script Property `EMAIL_PROVIDER_KEY`. From and Reply-To `info@renfluence.com`,
  provider MailerSend (`EMAIL_PROVIDER` property switches to `resend` or `gmail`, the info@ alias fallback). Sends only to «Work email», only when «Consent» is filled, once per
  row (column «Thank-you sent», added at the right of the leads Sheet only while the flag is on; written before the send), 300 a day at most. `TEST` names
  are skipped unless the property `TEST_TO` is george.koulouris@renfluence.com (then only he gets it). `OFFER_TEXT` (voucher line) is empty on purpose until
  the team confirms an offer. The same address is mailed once per 6 hours. With the `gmail` provider set the key property to any text. The core of `thank-you.gs` is identical in ei-kiosk and ws-kiosk (only the brand block and the HTML differ): change both. Editor functions: `dryRun` (logs, sends nothing), `sendTestMail` (one mail to George, needs the key). New scope
  `script.external_request` (and full Gmail access, from the fallback's `GmailApp`): pasting this code needs `install()` run again at once, even with the flag off, or the trigger stops with an authorisation error. The consent line says "contact me about this conversation" and does not name email: George decides on adding "including by email" before switching this on.
- The layout scales with `rem` from `html { font-size: clamp(...) }`. Option areas scroll inside on short screens, never sideways.

## Thank-you mailer (live)

`mailer-standalone.gs` is a separate Apps Script project owned by info@renfluence.com, and it is live: one 5-minute trigger (`sendPending`) mails the «Work email» of every leads-Sheet row from `FIRST_ROW` (8) down that has «Consent» filled and no «Thank-you sent» marker, from and Reply-To info@renfluence.com. It never mails a row without that consent, and it writes the marker before the send (one try per row, one mail per address per 6 hours). `OFFER_TEXT` is empty until an offer is confirmed. Switch off: run `removeTrigger()` in the editor and set `SEND_THANK_YOU = false`. Flags, text, colours and open points are in `mailer-standalone-README.md`. Check it with `node mailer-check.mjs`.

Second job in the same file, `notifyOwners()` (flag `NOTIFY_OWNERS`, own trigger `installNotifyTrigger()` every minute, own marker column «Owner notified», rows from `NOTIFY_FIRST_ROW` down): one plain mail from info@ to the lead's owner (the Owner cell, else Routed owner, else Petros) with first name, company, business type, score and band, product, «Spoke with» and the Sheet row link, subject «New Web Summit lead: <first name> <company>». Addresses come from `OWNER_EMAIL` (copied from the old capture script); an owner without one is marked «skipped» and logged. `TEST` names are skipped, or mailed only to George when `TEST_TO` is his address. `dryRunNotify()` logs the decision per row and sends nothing. Set `NOTIFY_FIRST_ROW` to the Sheet's last row + 1 on the day it is installed, and check `dryRunNotify()` shows no old row as «would send».

## Check

`node check.mjs [url] [screenshot-dir]` runs headless Chrome: every screen at 8 sizes in both orientations
(1180x820, 1133x744, 1280x800, 1024x768, 1366x1024, 390x844, 360x640, 1280x600) with a layout audit and
screenshots in `~/.local/state/pi-subagents/ws-kiosk-check/`, the Q7 and thank-you rules, the thank-you reset (there is no idle reset), the archive and CSV export, private-mode storage, the wording Sheet with a stubbed CSV (edited label shown,
posted body unchanged, cache offline, blank cell falls back, error page ignored), Q4's extra countries, and the offline queue
with `formResponse` intercepted. `ONLY=1280x800` limits the sizes. `LIVE=1` sends the offline-queue lead (name «TEST Koulouris
kiosk offline», tablet «TEST») to the real form (Q1 and Q2 «Something else» with the texts «TEST q1 other» and «TEST q2 other», who = Theo), so delete that Sheet row after.
`node mail-check.mjs` checks the thank-you email with Apps Script stubbed (no network): validation, template fill, plan, once-only, providers, the
`onLeadSubmit` hook off and on (and that it sends no owner mail). Healthy output ends with `PASS (25 checks)`. `mailer-check.mjs` ends with `PASS (33 checks)`.
Healthy `check.mjs` output ends with:

```
no idle reset: ok
offline queue: ok, posts = 1 (intercepted)
PASS
```
