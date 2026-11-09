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
- Q4 «United States», «Latin America» and «Asia» are plain top-level options (before «Elsewhere», score 5 in the Sheet, nothing opens); the Elsewhere list does not repeat them.
- Q4 «Other in Europe» and «Elsewhere» each open their own list and a «Which market?» field on the same screen (`q.more.groups`).
  Both post as one answer to the extra Form question «Other markets» (`entry.496172218`, optional, same section as Q4), list then
  text per open group, comma-joined, never to Q4's own checkbox, so the Sheet's scoring still reads Q4 as before. In the leads
  Sheet the column sits after «Tablet» and before «Score».
- Q1 and Q2 «Something else» open an optional text field (`ask`). The Form's «Something else» is a plain option with no free-text
  response, so the typed text posts to two extra optional short-answer Form questions at the end of the details section, «Q1 other text»
  (`entry.415824857`) and «Q2 other text» (`entry.1228148969`). Q1 and Q2 themselves still post only their option. In the leads Sheet
  they sit after «Other markets» and before «Score» (the archive and CSV use the same order). The Form keeps a column for a deleted
  question, so never delete and re-add a Form question: the Sheet gets a dead duplicate column.

## Questions follow Petros's doc (10 Nov update)

- New options: Q1 «Startup (a young company growing its brand)» (after Brand, score 25, routed like Brand), Q4 United States, Latin America, Asia, Q5
  «Relevant content trends and media search (find videos by context: what is said and shown)» (no routing effect, max 3 holds). Q5 has nine options, so `dense` tightens it to fit 1280x800.
- **Release order**: the Form's options and the leads Sheet's formulas first (Score `V1`: add `Startup \(` to the Brand 25 branch and `United States|Latin America|Asia` to the
  Elsewhere 5 branch of the market regex; Band `W1`: add `Startup \(` to the Agency|Brand|Government|Tech list, else Startup lands in «Check with Petros»), then push `index.html`.
  A posted option the Form lacks loses the lead. A test lead with Startup, Director or Head of, Own brand, United States, trends, Our own tool, 4 to 10, next 3 months scores 78 Hot, Edge.
- Wording-only differences from the doc stay out of the Form: Q2 casing (Director or Head, Manager or Lead, Specialist or Executive) and Q5 creators «audience, content mix, performance and past brand partners»
  are Sheet rows (`role.*`, `help.creators.sub`); the posted values are still the Form's. The Sheet's explicit rows beat the built-in text, so editing `index.html` alone never changes them.

## Never lose a lead

- Every submitted lead is appended to `localStorage` `ws-kiosk-archive` (timestamp with the Athens offset,
  device, answers by question, the posted body, sent time) before the thank-you shows, and never removed.
- `?export` (team only, never linked from the kiosk flow): counts, **Download CSV** (UTF-8 BOM, Sheet column
  order, formula-looking text prefixed with `'`), **Retry sending now**, and the field «Όνομα tablet».
- The device name is stored in `ws-kiosk-device`, shown small on the welcome screen (amber «Tablet: not set»),
  and posted as the Form question «Tablet» (`entry.938892717`, short answer, not required, never shown to visitors).
- `navigator.storage.persist()` is requested. If `localStorage` fails, a red banner shows on the welcome screen
  and leads stay in memory for that page.
- The reset after the thank-you is a deadline checked four times a second (and on visibility, focus, pageshow),
  so a throttled tablet still resets. **Next visitor** resets at once.
- `sheet-owner.gs` is the Apps Script bound to the Sheet (copy of what runs there). `install()` creates the
  `onFormSubmit` trigger: it sets Owner from Routed owner when empty and emails that owner. Names starting with
  `TEST` get an Owner but no owner email.
- `thank-you.gs` is the **second file** of that Apps Script project (paste both; `sheet-owner.gs` alone fails on the missing constants) and can mail
  the visitor. Off twice: `SEND_THANK_YOU = false` and no Script Property `EMAIL_PROVIDER_KEY`. From and Reply-To `info@renfluence.com`,
  provider MailerSend (`EMAIL_PROVIDER` property switches to `resend` or `gmail`, the info@ alias fallback). Sends only to «Work email», only when «Consent» is filled, once per
  row (column «Thank-you sent», added at the right of the leads Sheet only while the flag is on; written before the send), 300 a day at most. `TEST` names
  are skipped unless the property `TEST_TO` is george.koulouris@renfluence.com (then only he gets it). `OFFER_TEXT` (voucher line) is empty on purpose until
  the team confirms an offer. The same address is mailed once per 6 hours. With the `gmail` provider set the key property to any text. The core of `thank-you.gs` is identical in ei-kiosk and ws-kiosk (only the brand block and the HTML differ): change both. Editor functions: `dryRun` (logs, sends nothing), `sendTestMail` (one mail to George, needs the key). New scope
  `script.external_request` (and full Gmail access, from the fallback's `GmailApp`): pasting this code needs `install()` run again at once, even with the flag off, or the trigger stops with an authorisation error. The consent line says "contact me about this conversation" and does not name email: George decides on adding "including by email" before switching this on.
- The welcome panel shows `brand.tagline` «Where Content Meets Clarity» (no full stop) under the logo in #00F0FF (4.2:1 on #0051FD, so large bold only); the same line with a full stop is still `intro.tagline`.
- The layout scales with `rem` from `html { font-size: clamp(...) }`. Option areas scroll inside on short screens, never sideways.

## Check

`node check.mjs [url] [screenshot-dir]` runs headless Chrome: every screen at 8 sizes in both orientations
(1180x820, 1133x744, 1280x800, 1024x768, 1366x1024, 390x844, 360x640, 1280x600) with a layout audit and
screenshots in `~/.local/state/pi-subagents/ws-kiosk-check/`, the Q7 and thank-you rules, the idle and
thank-you resets, the archive and CSV export, private-mode storage, the wording Sheet with a stubbed CSV (edited label shown,
posted body unchanged, cache offline, blank cell falls back, error page ignored), Q4's extra countries, and the offline queue
with `formResponse` intercepted. `ONLY=1280x800` limits the sizes. `LIVE=1` sends the offline-queue lead (name «TEST Koulouris
kiosk offline», tablet «TEST») to the real form (Q1 and Q2 «Something else» with the texts «TEST q1 other» and «TEST q2 other»), so delete that Sheet row after.
`node mail-check.mjs` checks the thank-you email with Apps Script stubbed (no network): validation, template fill, plan, once-only, providers, the
`onLeadSubmit` hook off and on. Healthy output ends with `PASS (25 checks)`.
Healthy `check.mjs` output ends with:

```
idle reset: ok
offline queue: ok, posts = 1 (intercepted)
PASS
```
