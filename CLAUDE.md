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

## Check

`node check.mjs [url] [screenshot-dir]` runs headless Chrome: every screen at 1280x800 and 800x1280,
the Q7 and thank-you rules, the idle and thank-you resets, and the offline queue with `formResponse`
intercepted. `LIVE=1` sends the offline-queue lead to the real form, so delete that Sheet row after.
Healthy output ends with:

```
idle reset: ok
offline queue: ok, posts = 1 (intercepted)
PASS
```
