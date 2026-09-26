# Railway Inspection &amp; Compliance Management System

An inspection and compliance platform for the Railway Commercial Department, covering three
inspection streams through one common workflow:

| Module | Scope |
| --- | --- |
| **Passenger Amenities** | Facilities and services provided to passengers at stations and other passenger interfaces |
| **Commercial Inspection** | Commercial working, revenue, contracts, licences, ticketing, catering, parcel and parking |
| **Safe Running &ndash; Commercial** | Commercial-department items bearing on safe, orderly and compliant running of passenger trains |

The inspector's job stays simple &mdash; **select &rarr; observe &rarr; assign &rarr; submit**. Everything
after that is automatic:

```
One inspection -> many observations -> automatic responsibility -> automatic notification
   -> time-bound compliance -> verification -> closure -> analytics
```

<p align="center">
  <img src="docs/screenshots/new-inspection.png" alt="The New Inspection screen on a phone" width="300">
  <img src="docs/screenshots/home-mobile.png" alt="Home screen with the three inspection modules" width="300">
</p>

---

## Quick start

```bash
npm install                 # installs the API and the web client
npm run seed:reset          # master data + a demonstration dataset
npm run dev                 # API on :4000, web client on :5173
```

Open <http://localhost:5173> and sign in with any seeded account &mdash; password `Railway@2026`:

| Employee ID | Role | Who they are |
| --- | --- | --- |
| `CMI01` | Inspecting officer | Chief Commercial Inspector, Jabalpur |
| `SSEEL01` | Supervisor | SSE/Electrical &mdash; receives the assigned observations |
| `SRDCM01` | Divisional officer | Sr. DCM &mdash; dashboards, monitoring, verification |
| `ADMIN01` | Administrator | Full system control, master data, audit trail |
| `VIEW01` | Viewer | Read-only |

The sign-in screen lists every demonstration account (outside production) so nothing has to be
looked up.

### Running it as one process

```bash
npm run build               # builds the web client into web/dist
npm start                   # the API serves the API and the built client on :4000
```

### Tests

```bash
npm test                    # 41 unit and API tests: engines, workflow, RBAC, sync, reports, TDC
npm run smoke               # end-to-end walkthrough against a running server
```

`npm test` runs against throw-away databases and needs nothing else. `npm run smoke` drives the
reference scenario through a running server (`npm start`) and prints each check as it goes.

---

## What the system does

### 1. The 30-second observation

The New Inspection screen follows the workflow exactly, with the observation field as the most
prominent input:

```
Inspection Type -> Station / Train -> Unit / Area -> Amenity, Service or Inspection Item
   -> Observation -> Action By -> Concerned Supervisor -> TDC (optional) -> SUBMIT
```

* **Searchable dropdowns everywhere.** Picking a station immediately shows its division, zone,
  category and type; the Unit list is rebuilt for that station; the item list is filtered to the
  module and to whether this is a station or a train.
* **Voice-to-text** for the observation (Web Speech API, hidden where unsupported), **camera
  capture** and multiple photographs or a short video.
* **Checklist parameters** per item (Available, Functional, Clean, Adequate, Accessible, &hellip;),
  configurable per item by the administrator.
* **The inspector never types a mobile number.** Station + Unit + Action By resolves the concerned
  supervisor automatically.
* **TDC stays optional** &mdash; "No TDC" is a first-class choice.
* One inspection carries any number of observations; the context stays put between submissions.

### 2. Smart assignment

`Station + Unit + Action By (+ item)` resolves the responsible supervisor from the Concerned
Supervisor Master, best match first, and says *why* it matched:

| Rank | Match |
| --- | --- |
| 10 | Explicit coverage for this exact station and unit |
| 20 | Explicit coverage for this station and unit kind (all platforms, all toilets &hellip;) |
| 25 | Coverage for this inspection category |
| 30 | Coverage for this station |
| 40 | Posted at this station, area of responsibility matches the unit |
| 50 | Posted at this station in this department |
| 60 | Nominated departmental supervisor |
| 70 | Any active supervisor in the department |

If several supervisors qualify, the best is pre-selected and the rest stay in a searchable
dropdown. If none exists, the observation is still recorded and the divisional office is told that
a nomination is missing.

### 3. Repeated deficiency detection

Before the inspector submits, the system looks back over a configurable window and flags
recurrences:

> **Drinking Water &ndash; Platform No. 2 &ndash; repeated deficiency observed 3 times in the last 90 days.**

Matching is by unit + item, by item at the same location, or by keyword overlap (with a small
stemmer, so "not functioning" matches "not functional") within the same category. Each match shows
its reason, similarity and status, and a **photo comparison** view puts the current photographs
next to the earlier ones.

### 4. Time-bound compliance

```
Submitted -> Assigned -> Acknowledged -> Action in progress
          -> Compliance submitted -> Verified -> Closed
```

with `Rejected`, `Reopened` and `Cancelled` as alternate outcomes. **Overdue is derived**, not
stored: an observation is overdue when its TDC has passed and the department still owes an action,
so the badge can never drift out of step with the workflow. An observation whose compliance is
already submitted is awaiting the inspecting officer, not the department, and is not counted
against the department.

A daily sweep sends pre-due reminders, due-date reminders and overdue reminders, and escalates
through the configured hierarchy (reporting officer &rarr; divisional officer &rarr; divisional
head). The sweep is idempotent per day, so running it twice never double-notifies.

Verification gives the inspecting officer three outcomes: **accept** (closed, with an optional
digital signature), **reject** (reopened, reason mandatory) or **physical verification required**
(stays open until seen on the ground). Every round of compliance is kept &mdash; nothing is
overwritten.

### 5. Dashboards and reports

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Divisional dashboard" width="760">
</p>

Overview, module-wise, department-wise, station-wise, severity, 90-day trend, repeated
deficiencies and a supervisor scoreboard, all honouring the same filters. Eight report types
(inspection, compliance, pending, overdue, department-wise, station-wise, repeated deficiency,
module-wise) export as **PDF, Excel or CSV**. Inspection PDFs carry the observations, photographs,
signatures and a **QR code** that verifies the report against the live record without a login.

### 6. Works offline

The web client is an installable PWA. With no connectivity it keeps the master data it last saw,
records inspections, observations and photographs in IndexedDB, shows **"Offline &ndash; saved
locally"**, and uploads everything automatically when the signal returns
(**"Successfully synced"**). Every queued item carries a client UUID, so a retry can never create a
duplicate. The pending queue is visible and under the inspector's control.

### 7. Administration and audit

<p align="center">
  <img src="docs/screenshots/admin-masters.png" alt="Admin panel" width="760">
</p>

Twenty-one master tables are editable from the Admin Panel &mdash; stations, units, amenities,
inspection items, checklist parameters, departments, supervisors and their coverage, trains,
contractors and licensees, severities, categories, TDC rules, notification rules and the escalation
hierarchy. **Routine master-data changes never need a code change.** Masters are deactivated rather
than deleted, so historical observations keep pointing at a valid record.

Every state-changing action writes an audit row with the user, role, timestamp, action, entity and
the **previous and new value**. Submitted observations are never silently modified: the text can be
corrected only by the raising officer before acknowledgement (or by an administrator), and every
correction is recorded on the timeline and in the audit trail.

---

## Architecture

```
railway-inspection-suite/
├── server/                  Node.js + Express + SQLite (better-sqlite3)
│   ├── src/db/              schema.sql, migrations, seed + master data
│   ├── src/lib/             assignment, repeats, notify, scheduler, exporters, queries
│   ├── src/services/        observation service shared by the API and offline sync
│   ├── src/routes/          auth, masters, inspections, observations, compliance,
│   │                        dashboard, history, reports, notifications, search, sync, admin
│   └── tests/               node:test + supertest
└── web/                     React 18 + TypeScript + Vite (PWA)
    ├── src/components/      UI kit, charts (hand-built SVG), app shell
    ├── src/pages/           one file per screen
    ├── src/state/           auth, offline queue, toasts
    └── public/              manifest, service worker, generated icons
```

**Why SQLite.** The whole system runs from one process with no external services, which suits
divisional deployment and makes evaluation trivial. The data layer is plain SQL behind small
helpers, so moving to PostgreSQL is a schema translation rather than a rewrite.

**Scaling to more modules.** A new inspection stream is a row in `modules` plus its item groups and
items. Nothing in the workflow, assignment, reminder, reporting or dashboard code is aware of which
module an observation belongs to, so additional modules and departments need no redesign.

### Roles

| Role | Can do |
| --- | --- |
| Administrator | Everything, including master data, users and system operations |
| Divisional Officer | Dashboards, monitoring, reports, verification, reassignment, cancellation |
| Inspecting Officer | Create inspections and observations, assign, verify compliance |
| Supervisor | See assigned observations, acknowledge, submit compliance |
| Viewer | Read-only |

Access is enforced on the server in two layers: a capability check per endpoint, and a row-level
scope (a supervisor sees the observations assigned to them or to their department at their station;
officers and inspectors see their division).

### Security

Password and OTP sign-in (bcrypt, JWT with server-side session records), account lockout after
repeated failures, session timeout and revocation, rate limiting, Helmet with a content-security
policy in production, whitelisted master-data columns, parameterised SQL throughout, upload type
and size limits, evidence served only to an authenticated session, and a complete audit trail.
`JWT_SECRET` is mandatory in production &mdash; the server refuses to start without it.

---

## Configuration

Copy `server/.env.example` to `server/.env`. Everything has a working development default:

| Variable | Purpose |
| --- | --- |
| `PORT`, `HOST` | API binding |
| `DATA_DIR`, `DB_FILE`, `UPLOAD_DIR` | Where the database, evidence and backups live |
| `JWT_SECRET` | **Required in production** |
| `SESSION_TIMEOUT_MINUTES` | Session lifetime |
| `SCHEDULER_ENABLED`, `SCHEDULER_CRON`, `SCHEDULER_TZ` | TDC reminder and escalation sweep |
| `EMAIL_ENABLED`, `SMTP_URL`, `SMS_ENABLED`, `SMS_GATEWAY_URL` | Notification channels |
| `WEB_ORIGINS`, `PUBLIC_URL` | CORS and the URL embedded in report QR codes |

In-app notifications are always live. Email and SMS are pluggable: point them at a gateway URL, or
enable them without one and messages are written to the server log and recorded as sent by the
`log` provider &mdash; so delivery status stays honest in every deployment.

---

## The reference scenario

The seeded data reproduces the specification's end-to-end test, and the workflow test suite drives
it on every run:

> **Inspection Type** Passenger Amenities &middot; **Station** Jabalpur &middot; **Unit** Platform No. 2 &middot;
> **Amenity** Drinking Water &middot; **Observation** "Water cooler is not functioning." &middot;
> **Action By** Electrical &middot; **Supervisor** identified automatically &middot; **TDC** 30 September 2026 &middot;
> **Photo** attached

On submit the system generates the observation ID, saves it, identifies SSE/Electrical Rajesh
Meshram from the Supervisor Master, sends the notification, shows it in his queue, starts TDC
monitoring, accepts his compliance, notifies the inspecting officer, and closes the observation on
acceptance &mdash; updating every dashboard and report on the way.

<p align="center">
  <img src="docs/screenshots/observation-detail.png" alt="Observation detail" width="760">
</p>

The same dataset also carries earlier occurrences of that deficiency, so the repeated-deficiency
banner appears before the inspector even submits, and observations in every other state: acknowledged,
action in progress, compliance submitted, rejected and reopened, closed, overdue and escalated,
cancelled, with and without a TDC, at stations and on trains, across all three modules.

## Further documentation

* [`docs/API.md`](docs/API.md) &mdash; every endpoint, its parameters and its access rules
* [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) &mdash; tables, relationships and the derived fields
