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
thank-you resets, the archive and CSV export, private-mode storage, and the offline queue with `formResponse`
intercepted. `ONLY=1280x800` limits the sizes. `LIVE=1` sends the offline-queue lead (name «TEST Koulouris
kiosk offline», tablet «TEST») to the real form, so delete that Sheet row after.
Healthy output ends with:

```
idle reset: ok
offline queue: ok, posts = 1 (intercepted)
PASS
```
