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

1. **`CMI01` &rarr; New Inspection.** Pick what the inspection covers &mdash; *a station* &mdash;
   type `pendra` in Station, set the times, and press **START INSPECTION**. Every area of Pendra
   Road goes on the sheet at once, each one reading *Not inspected*.
2. **Open Platform No. 1 and work it.** Tap a group to open its checklist, then **In order** on a
   couple of items. The area turns to *Found in order* and the coverage bar at the top moves. Use
   **Whole area in order** on the next area to do it in one tap.
3. **Tap Deficiency on an item.** The observation form opens with the area and the item already
   filled in. The division's MEA position appears &mdash; *3 water coolers provided against 4
   required* &mdash; the repeated-deficiency banner shows for a recurrence, and the concerned
   supervisor is filled in with the reason for the match. Open **Suggested deficiency**, pick one,
   and submit: the form closes and the area is now *Deficiencies noticed*.
4. **Mark Subway as "Not available here".** An area that does not exist is recorded as such, and is
   left out of the coverage percentage rather than counted against the officer.
5. Press **Finish**. It warns about the areas still not attended to &mdash; they will appear in the
   report as not inspected &mdash; then shows the report: the coverage, **Part I** (what the last
   inspection of Pendra Road left outstanding), **Part IV** (what was checked and found in order)
   and the signature. **Issue the report** to give it its office number in the financial-year
   series.
6. **Open INSP-2026-000001** (Bilaspur, still in progress) for the full picture: 24 of 25 areas
   attended to, 144 items found in order, four deficiencies, and Part I showing two items from the
   previous inspection reviewed on site &mdash; one complied, one not.
7. Choose **Inspection note** to compile selected observations into the numbered office letter, and
   print it straight from the browser.
8. **Sign out and sign in as `SSEEL01`.** The observations are in the compliance queue and in the
   notification bell. Acknowledge one, then submit compliance.
9. **Back as `CMI01`.** Verify it: reject it once (a reason is mandatory) and watch it reopen, then
   accept the next round and see it close with the full timeline.
10. **`SRDCM01` &rarr; Dashboard &rarr; Inspection-wise** for the visits, the coverage and the items
    checked by each officer &mdash; the half that counting observations cannot answer. Then
    **Repeated** for the most-reported deficiencies, and **Reports**, where the reports built on the
    inspection are listed apart from those built on the observations.
11. **Station History** for the previous-vs-current comparison. Open any station and the
    **Facilities & norms** tab shows the divisional record: what the station has, and where it
    stands against the minimum essential amenities.
12. **`ADMIN01` &rarr; Admin &rarr; Supervisors** to see which stations and departments each
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
npm run check:demo        # drives the result in a real browser, from file://
```

The fixture is exported from the seeded SQLite database by `web/scripts/make-demo-data.mjs`, so the
demonstration always matches the real seed. The application code is identical between the two
builds: only `web/src/api/transport.ts` is swapped for `transport.demo.ts`, which routes requests to
the in-browser backend, serves evidence from embedded images and switches to hash-based routing.

The backend, though, is a second implementation &mdash; `web/src/demo/router.ts` mirrors the
server's engines in the browser &mdash; so the two can drift. A route the server has and the demo
does not fails as a toast *inside the page*: no console error, no failed request, nothing a
type-check or a unit test would see. `npm run check:demo` is what catches that. It walks an
inspection through to its issued report and fails on any error toast, any page error, or any
network request at all. It needs Playwright, which is not a dependency of this repository, so it
says how to install it and skips rather than failing if it is absent:

```bash
npm i -D playwright && npx playwright install chromium
```
