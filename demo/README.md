# Offline demonstration build

`railway-inspection-demo.html` is the whole application in a single file. Open it in any modern
browser &mdash; double-click it, or drag it into a browser window. There is **no server, no install
and no network traffic**: the interface, the demonstration data and the workflow engines are all
inside the file.

Sign in with any of these (the sign-in screen lists them all), password `Railway@2026`:

| Employee ID | Role | What to look at |
| --- | --- | --- |
| `CMI01` | Inspecting officer | New Inspection, repeated-deficiency warning, verification queue |
| `SSEEL01` | Supervisor | Compliance queue, acknowledge and submit compliance |
| `SRDCM01` | Divisional officer | Dashboards, station history, reports |
| `ADMIN01` | Administrator | Admin panel over all 21 masters, audit trail |

## Suggested walkthrough

1. **`CMI01` &rarr; New Inspection.** Type `jabal` in Station, pick Platform No. 2, then Drinking
   Water. The repeated-deficiency banner appears before you submit, and the concerned supervisor is
   filled in with the reason for the match.
2. Write "Water cooler is not functioning.", set **Action By** to Electrical, switch TDC on, submit.
3. **Sign out and sign in as `SSEEL01`.** The observation is in the compliance queue and in the
   notification bell. Acknowledge it, then submit compliance.
4. **Back as `CMI01`.** Verify it: reject it once (a reason is mandatory) and watch it reopen, then
   accept the next round and see it close with the full timeline.
5. **`SRDCM01` &rarr; Dashboard** for the module, department and station views, and **Station
   History** for the previous-vs-current inspection comparison.

## What is real and what is not

Everything you do is genuinely executed: reference numbers, supervisor assignment, repeated-
deficiency detection, notifications with per-channel delivery status, the timeline, the audit trail,
dashboards and CSV export all run the same rules as the server.

Three things need the server and are stated as such in the interface:

* **PDF and Excel reports** &mdash; generated server-side, with photographs, signatures and the
  verification QR code. CSV export works here.
* **Email and SMS delivery** &mdash; in-app notifications are live; the other channels show as
  `skipped`, exactly as they do in a deployment with those channels switched off.
* **The nightly TDC sweep** &mdash; it can be run on demand from Admin &rarr; System, but nothing
  runs on a schedule inside a browser tab.

Data lives in memory for the life of the page: **reloading restores the original demonstration
dataset**. Nothing is written to disk and nothing leaves the machine.

## Rebuilding it

```bash
npm run build:demo        # reseeds, exports the fixture, builds, inlines into one file
```

The fixture is exported from the seeded SQLite database by `web/scripts/make-demo-data.mjs`, so the
demonstration always matches the real seed. The application code is identical between the two
builds: only `web/src/api/transport.ts` is swapped for `transport.demo.ts`, which routes requests to
the in-browser backend, serves evidence from embedded images and switches to hash-based routing.
