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
| `ADMIN01` | Administrator | Admin panel over all 27 masters, supervisor links, station import, audit trail |

## Suggested walkthrough

1. **`CMI01` &rarr; New Inspection.** Type `pendra` in Station, pick Platform No. 2, then Water
   Cooler. The division's MEA position appears &mdash; *3 water coolers provided against 4 required* &mdash;
   the repeated-deficiency banner shows for a recurrence, and the concerned supervisor is filled in
   with the reason for the match (here, the section SSE who covers Pendra Road).
2. Open **Suggested deficiency** and pick *Water cooler is not functioning.* &mdash; the wording, the
   department and the TDC are filled in together. Submit.
3. **Stay on the screen and record a second one.** Change the Amenity to Toilet, pick a suggestion
   from its own list, and submit again: one inspection, two observations, with a running list of what
   has been recorded.
4. Choose **Inspection note** on that list. Tick the observations to include, adjust the subject and
   the paragraphs, and issue it &mdash; the letter is numbered in the office series and can be
   printed straight from the browser.
5. **Sign out and sign in as `SSEEL01`.** The observations are in the compliance queue and in the
   notification bell. Acknowledge one, then submit compliance.
6. **Back as `CMI01`.** Verify it: reject it once (a reason is mandatory) and watch it reopen, then
   accept the next round and see it close with the full timeline.
7. **`SRDCM01` &rarr; Dashboard &rarr; Repeated** for the most-reported deficiencies and the
   recurring ones, and **Station History** for the previous-vs-current inspection comparison. Open
   any station and the **Facilities & norms** tab shows the divisional record: what the station has,
   and where it stands against the minimum essential amenities.
8. **`ADMIN01` &rarr; Admin &rarr; Supervisors** to see which stations and departments each
   supervisor answers for, and **Master data &rarr; Station &rarr; Import** to paste a CSV and press
   *Check* &mdash; it reports what would change without writing anything.

## What is real and what is not

The station data is the division's own: 89 stations on 8 sections, with their PAMS facility record
and their minimum-essential-amenity position. Names are not &mdash; every account and supervisor is a
post ("SSE/Works - Champa"), because the nomination is the division's to make.

Everything you do is genuinely executed: reference numbers, supervisor assignment, repeated-
deficiency detection, notifications with per-channel delivery status, the timeline, the audit trail,
dashboards and CSV export all run the same rules as the server.

Three things need the server and are stated as such in the interface:

* **PDF and Excel reports** &mdash; generated server-side, with photographs, signatures and the
  verification QR code. CSV export works here, and an Inspection Note prints from the browser
  (*Print* &rarr; save as PDF), which produces the same letter the server renders.
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
