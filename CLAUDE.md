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
- The reset after the thank-you is a deadline checked four times a second (and on visibility, focus, pageshow),
  so a throttled tablet still resets. **Next visitor** resets at once.
- `sheet-owner.gs` is the Apps Script bound to the Sheet (copy of what runs there). `install()` creates the
  `onFormSubmit` trigger: it sets Owner from Routed owner when empty and emails that owner. Names starting with
  `TEST` get an Owner but no email. Never mails visitors.
- The layout scales with `rem` from `html { font-size: clamp(...) }`. Option areas scroll inside on short screens, never sideways.

## Check

`node check.mjs [url] [screenshot-dir]` runs headless Chrome: every screen at 8 sizes in both orientations
(1180x820, 1133x744, 1280x800, 1024x768, 1366x1024, 390x844, 360x640, 1280x600) with a layout audit and
screenshots in `~/.local/state/pi-subagents/ws-kiosk-check/`, the Q7 and thank-you rules, the idle and
thank-you resets, the archive and CSV export, private-mode storage, the wording Sheet with a stubbed CSV (edited label shown,
posted body unchanged, cache offline, blank cell falls back, error page ignored), Q4's extra countries, and the offline queue
with `formResponse` intercepted. `ONLY=1280x800` limits the sizes. `LIVE=1` sends the offline-queue lead (name «TEST Koulouris
kiosk offline», tablet «TEST») to the real form (Q1 and Q2 «Something else» with the texts «TEST q1 other» and «TEST q2 other»), so delete that Sheet row after.
Healthy output ends with:

```
idle reset: ok
offline queue: ok, posts = 1 (intercepted)
PASS
```
