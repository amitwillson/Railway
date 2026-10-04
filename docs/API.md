# API reference

Base URL `/api`. Every endpoint except those marked **public** needs
`Authorization: Bearer <token>`.

Errors always use the same shape:

```json
{ "error": { "code": "BAD_REQUEST", "message": "Validation failed", "details": [ ... ] } }
```

| Code | Status | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | No session, expired session or signed out |
| `FORBIDDEN` | 403 | The role or row-level scope does not allow it |
| `NOT_FOUND` | 404 | No such record |
| `DUPLICATE` | 409 | A unique constraint would be violated |
| `BAD_REQUEST` | 400 | Validation failed; `details` names the fields |
| `RATE_LIMITED` | 429 | Too many requests |

## Capabilities by role

| Capability | Admin | Divisional Officer | Inspector | Supervisor | Viewer |
| --- | :-: | :-: | :-: | :-: | :-: |
| Read inspections / observations | ✓ | ✓ | ✓ | ✓ (scoped) | ✓ |
| Create inspection / observation | ✓ | ✓ | ✓ | | |
| Acknowledge, submit compliance | ✓ | | | ✓ | |
| Verify compliance | ✓ | ✓ | ✓ (own) | | |
| Reassign, reopen | ✓ | ✓ | ✓ (own) | | |
| Cancel | ✓ | ✓ | | | |
| Dashboards, reports | ✓ | ✓ | ✓ | ✓ | ✓ |
| Master data (read) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Master data (write), users, settings | ✓ | | | | |
| Audit trail | ✓ | ✓ | | | |

Row-level scope: a supervisor sees observations assigned to them, or to their department at their
station, or that they raised. Officers, inspectors and viewers see their division. Administrators
see everything.

## Authentication

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | `{ identifier, password }` &rarr; `{ token, expires_at, user }` |
| POST | `/auth/otp/request` | `{ identifier }`; never reveals whether the account exists |
| POST | `/auth/otp/verify` | `{ identifier, code }` |
| GET | `/auth/me` | Current user and unread notification count |
| POST | `/auth/logout` | Revokes this session |
| GET | `/auth/sessions` | Active sessions for this user |
| DELETE | `/auth/sessions/:id` | Ends one session |
| POST | `/auth/change-password` | Signs out every other session |
| GET | `/auth/demo-users` | **Public**, non-production only |

## Master data

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/masters/bootstrap` | Everything the inspection screen needs, in one call |
| GET | `/masters/stations` | `q` (name, code or section), `division_id`, `zone_id`, `section`, `limit` |
| GET | `/masters/stations/:id` | With its units, everyone who answers for it, the PAMS facility record and the MEA position |
| GET | `/masters/stations/:id/norms` | `item_id` &rarr; what is provided against what the norm requires, worst shortfall first |
| GET | `/masters/sections` | The sections of the division, with the station count of each |
| GET | `/masters/trains`, `/masters/trains/:id` | `q` |
| GET | `/masters/units` | `station_id`, `location_type`, `applies_to` |
| GET | `/masters/items` | `module_code`, `applies_to`, `group_id`, `q`; returns flat and grouped |
| GET | `/masters/items/:id` | With the checklist parameters configured for it |
| GET | `/masters/items/:id/deficiencies` | **What usually fails here.** `station_id` &rarr; suggestions narrowest scope first (item, group, module, generic) plus `previously_used`, the wordings already recorded for the item |
| GET | `/masters/supervisors` | `department_id`, `station_id`, `q`; both filters look through the link tables, and each row carries its `stations` and `departments` |
| GET | `/masters/supervisors/:id` | One supervisor with every station and department link, and the coverage rows |
| GET | `/masters/supervisors/resolve` | **Smart assignment.** `station_id`, `unit_id`, `department_id`, `item_id` &rarr; ranked candidates, `auto_selected` and `match_reason` |
| GET | `/masters/departments`, `/severities`, `/categories`, `/inspection-types`, `/parameters`, `/rule-references`, `/modules`, `/contractors` | Reference lists |

## Inspections

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/inspections` | `mine`, `module_id`, `station_id`, `train_id`, `status`, `from`, `to`, `q`, paging |
| POST | `/inspections` | `scope` (`station` / `train` / `section`), `from_time`, `to_time`, `joint_with`. Opens the full sheet unless `open_sheet: false`; `client_uuid` makes it idempotent |
| GET | `/inspections/:id` | With its areas, item results, observations, approvals and attachments |
| PATCH | `/inspections/:id` | Title, summary, general remarks, times, notes, status |
| GET | `/inspections/:id/summary` | Generated narrative summary and statistics |
| POST | `/inspections/:id/complete` | Optional remarks and digital signature |
| POST | `/inspections/:id/approve` | Officer counter-signature |

### The inspection sheet

One inspector attends to many areas - often every area - of a station in a single
visit, so the inspection is the unit of record and the areas sit inside it.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/inspections/:id/sheet` | Every area with its result, the items recorded in it, the deficiencies raised in it and the catalogue still available to tick off |
| GET | `/inspections/:id/areas/available` | The areas this location offers, whether or not they are on the sheet |
| POST | `/inspections/:id/sheet` | Puts areas on the sheet. With no `unit_ids` the whole station goes on |
| PATCH | `/inspections/:id/areas/:areaId` | `result` is `satisfactory`, `deficiencies`, `not_inspected` or `not_available`, plus `remarks` |
| POST | `/inspections/:id/areas/:areaId/items` | `results: [{item_id, result: ok \| deficient \| not_applicable, remarks, parameters}]` |
| GET | `/inspections/:id/previous` | What the previous inspection of this place left outstanding, with this visit's review of each |
| POST | `/inspections/:id/previous/:observationId` | `finding` is `complied`, `partially_complied`, `not_complied` or `dropped`. Complied is verification on the ground, so it closes the observation; not complied on a submitted compliance reopens it. Neither ever rewords the observation |
| GET | `/inspections/:id/report` | The whole report model: coverage, Parts I to V, statistics and signatures |
| POST | `/inspections/:id/issue` | Issues the report, giving it its financial-year office number. Refused before the inspection is completed, and refused twice |

Recording a deficiency marks its area and its item automatically, so the inspector
never says it twice. An area carrying a live observation cannot be marked in order;
cancelling the last one puts the area back to what it is. Once the report is issued
the sheet behind it is frozen, while the status of every observation it cites still
reads live.

## Observations

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/observations` | See the filter table below |
| GET | `/observations/counters` | Badge counts for the navigation |
| GET | `/observations/repeat-check` | Repeated-deficiency check before submitting |
| POST | `/observations` | Assignment, repeat detection and notification all run here |
| GET | `/observations/:id` | Timeline, attachments, compliance rounds, repeats, approvals, notifications, permissions |
| PATCH | `/observations/:id` | Category, severity, TDC, rule link; text only while correctable |
| POST | `/observations/:id/acknowledge` | Supervisor |
| POST | `/observations/:id/progress` | Supervisor, remarks required |
| POST | `/observations/:id/compliance` | `multipart/form-data`: `action_taken`, `remarks`, `compliance_date`, `files[]` |
| POST | `/observations/:id/verify` | `decision` = `accept` \| `reject` \| `physical_verification`; a rejection reason is mandatory |
| POST | `/observations/:id/reassign` | Department and/or supervisor, reason required |
| POST | `/observations/:id/reopen` | Officer, reason required |
| POST | `/observations/:id/cancel` | Officer, reason required |
| POST | `/observations/:id/attachments` | `multipart/form-data`, up to 10 files |
| DELETE | `/observations/:id/attachments/:attachmentId` | Not after closure |
| GET | `/observations/:id/repeats` | Recurrences of this observation |
| GET | `/observations/:id/photo-comparison` | Current photographs against earlier occurrences |

### Observation filters

`status` (csv) · `module_id` · `module_code` · `station_id` · `train_id` · `department_id` ·
`supervisor_id` · `severity_id` · `category_id` · `item_id` · `unit_id` · `inspection_id` ·
`created_by` · `division_id` · `open` · `closed` · `overdue` · `due_soon` ·
`awaiting_verification` · `repeated` · `critical` · `has_tdc` · `mine` · `assigned_to_me` ·
`from` · `to` · `tdc_from` · `tdc_to` · `days` · `q` ·
`sort` = `newest` \| `oldest` \| `tdc` \| `severity` \| `overdue` \| `status` · `page` · `page_size`

Booleans accept `1/0`, `true/false`, `yes/no`, `on/off`.

## Compliance, dashboards, history, search

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/compliance/queue` | The supervisor's queue, with bucket counts |
| GET | `/compliance/awaiting-verification` | The inspecting officer's queue |
| GET | `/compliance` | Compliance register with verification outcomes |
| GET | `/dashboard/overview` | Key metrics and compliance performance |
| GET | `/dashboard/home` | Compact payload for the home screen, including any inspection still in progress |
| GET | `/dashboard/inspections` | Inspection-wise: visits, coverage, areas attended to and items checked, by officer and by module |
| GET | `/dashboard/modules` | Module-wise statistics |
| GET | `/dashboard/departments` | Department-wise workload and closure time |
| GET | `/dashboard/stations` | Station-wise, with the module split |
| GET | `/dashboard/severity`, `/categories`, `/trends`, `/repeats`, `/supervisors` | Analytics |
| GET | `/dashboard/deficiencies` | Most reported deficiencies, counted from the suggestion the inspector picked rather than by matching text |
| GET | `/history/stations/:id` | Complete station history, summary and repeats |
| GET | `/history/stations/:id/compare` | Previous vs current inspection |
| GET | `/history/trains`, `/history/trains/:id` | Train register and history |
| GET | `/search` | Stations, trains, supervisors, inspections and observations |
| GET | `/notifications`, `/notifications/deliveries` | Inbox and per-channel delivery status |
| POST | `/notifications/:id/read`, `/notifications/read-all` | |

## Reports

`GET /reports/<type>?format=json|csv|xlsx|pdf` where `<type>` is `pending`, `overdue`, `critical`,
`compliance`, `department-wise`, `station-wise`, `repeated-deficiency`, `module-wise`,
`inspection-register`, `inspector-wise`, `observations` or `audit`. Filters: `from`, `to`,
`module_id`, `station_id`, `division_id`, `department_id`, `severity_id`, `status`, `q`, `days`,
`limit`; the inspection-based reports also take `inspector_id` and `scope`.

Two of them are built on the inspection rather than on the observation. Everything else counts
observations, which answers what is wrong and who has to fix it; these answer the other half -
what inspection work was done, and how much of each station it reached.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/reports/catalogue` | The report list the UI renders |
| GET | `/reports/inspection/:id` | One inspection in full - Part I the previous inspection's outstanding items, Part II the areas covered, Part III the deficiencies with responsibility and TDC, Part IV what was checked and found in order, Part V general remarks. The PDF carries the photographic annexure, the signatures and a QR code; the CSV stacks the parts; the Excel file gives each a sheet |
| GET | `/reports/inspection-register` | One row per inspection, never one per area: date, location, officer, areas on the sheet, areas attended to, coverage, items checked, deficiencies and whether the report has been issued |
| GET | `/reports/inspector-wise` | The same visits summed by the officer who made them, with average coverage and closure rate |
| GET | `/reports/verify/:token` | **Public** QR verification |

## Inspection notes

Several observations compiled into one numbered letter in the office format. A note is stored
rather than rendered on demand, because it is a record: its number and its wording stay as they
were issued, while the status of each observation it cites is read live.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/notes/draft` | `inspection_id`, or `observation_ids` as a comma-separated list. Returns the observations that would go in, the next number, a suggested subject and the standing wording |
| GET | `/notes/defaults` | The letterhead, office, addressee and standing paragraphs |
| GET | `/notes` | `inspection_id`, `station_id`, `status`, `mine`, paging |
| POST | `/notes` | `note:create`. Either `inspection_id` or `observation_ids`; `status: issued` issues it straight away |
| GET | `/notes/:id` | The note with its observations and `by_department` |
| PATCH | `/notes/:id` | Wording and status. An issued note can only be cancelled, not reworded |
| GET | `/notes/:id/print` | `format=pdf\|csv\|json`, `group_by_department=1`. The PDF is the letter: letterhead, number and date, subject, the observations tabulated, signature block and copy-to |
| GET | `/notes/verify/:token` | **Public** verification of a printed note |

## Offline sync

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sync/snapshot` | Master-data bundle for offline use |
| POST | `/sync/batch` | Up to 100 operations; each carries a `client_uuid` and is idempotent. An observation may reference its parent by `inspection_client_uuid` when the inspection was also created offline. Per-item results report `created`, `duplicate` or `failed` without losing the rest of the batch |
| GET | `/sync/status` | Server time and the caller's open count |

## Administration

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/resources` | The editable masters and their columns |
| GET | `/admin/masters/:resource` | `q`, `active`, `limit`, `offset` |
| POST | `/admin/masters/:resource` | Admin only; only whitelisted columns are accepted |
| PATCH | `/admin/masters/:resource/:id` | Admin only |
| DELETE | `/admin/masters/:resource/:id` | Deactivates; `?hard=true` deletes where there is no history |
| PUT | `/admin/items/:id/parameters` | Sets the checklist parameters for an item |
| GET | `/admin/stations/export` | The station list as CSV, in the shape the importer accepts |
| POST | `/admin/stations/import` | Admin only. `csv`, `dry_run`, `deactivate_missing`. Identified by station code: a known code is updated, a new one is added, nothing is deleted. The response reports what was added, updated, deactivated and skipped, with a reason per skipped row |
| GET/POST/PATCH | `/admin/users`, `/admin/users/:id` | User administration |
| POST | `/admin/users/:id/reset-password` | Issues a temporary password |
| GET/PUT | `/admin/settings` | Application settings |
| GET | `/admin/audit` | Audit trail with previous and new values |
| POST | `/admin/scheduler/run` | Runs the TDC sweep on demand (`dry_run` supported) |
| GET | `/admin/stats` | Configuration, record counts and delivery statistics |
| POST | `/admin/backup` | Point-in-time database backup |

## Files

`GET /api/files/:storedName` streams evidence to an authenticated session; `?download=1` forces a
download. Supervisors can only read evidence for observations they are allowed to see.
