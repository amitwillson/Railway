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
| GET | `/masters/stations` | `q`, `division_id`, `zone_id`, `limit` |
| GET | `/masters/stations/:id` | With its units and posted supervisors |
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
| POST | `/inspections` | `client_uuid` makes it idempotent |
| GET | `/inspections/:id` | With observations, approvals and attachments |
| PATCH | `/inspections/:id` | Title, summary, notes, status |
| GET | `/inspections/:id/summary` | Generated narrative summary and statistics |
| POST | `/inspections/:id/complete` | Optional remarks and digital signature |
| POST | `/inspections/:id/approve` | Officer counter-signature |

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
| GET | `/dashboard/home` | Compact payload for the home screen |
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
`observations` or `audit`. Filters: `from`, `to`, `module_id`, `station_id`, `division_id`,
`department_id`, `severity_id`, `status`, `q`, `days`, `limit`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/reports/catalogue` | The report list the UI renders |
| GET | `/reports/inspection/:id` | Full inspection report; the PDF carries photographs, signatures and a QR code |
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
