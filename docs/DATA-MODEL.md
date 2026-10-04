# Data model

SQLite, defined in [`server/src/db/schema.sql`](../server/src/db/schema.sql). Timestamps are
ISO-8601 UTC strings; plain dates are `YYYY-MM-DD`. Foreign keys are enforced.

## Organisation and location

| Table | Purpose |
| --- | --- |
| `zones`, `divisions` | Railway organisation |
| `sections` | The sections of the division. `stations.section` carries the code rather than a foreign key, because the station list is replaced wholesale from a CSV that names the section in text |
| `departments` | The "Action By" list, including external parties (contractor, licensee, vendor) |
| `stations` | Code, name, division, zone, category, type, section, platforms, state, district, route, chainage and coordinates. Replaceable in one step from CSV (Admin &rarr; Stations &rarr; Import) |
| `station_facilities` | What a station has, from the division's PAMS record: counters, catering, retiring rooms, FOB and second entry, passenger information, Divyangjan facilities, water supply, and the AEN and IOW units that answer for it. One row per station, carrying the date PAMS was last updated &mdash; it is a periodic extract, not something this system maintains |
| `station_amenity_norms` | **Minimum Essential Amenities**: provided against required, per station per norm item, linked to the inspection item where the names match. What the New Inspection screen shows at the moment of recording |
| `trains` | Number, name, origin, destination, type, pantry |
| `units` | Units and areas. `station_id IS NULL` makes the unit a template available at every station; `applies_to` separates station areas from train areas |

## People and access

| Table | Purpose |
| --- | --- |
| `users` | Employee ID, role, department, division, station, password hash, lockout state |
| `sessions` | One row per sign-in, so sessions can time out and be revoked centrally |
| `otp_codes` | Hashed one-time passwords with expiry and attempt count |
| `supervisors` | **Concerned Supervisor Master**: employee ID, designation, department, sub-department, station, section, area of responsibility, mobile, email, reporting officer, linked user |
| `supervisor_stations` | **Which stations a supervisor answers for.** The primary posting is one of these rows (`is_primary = 1`); the rest are the section they cover, which is how one SSE reaches every station on it |
| `supervisor_departments` | **Which departments a supervisor answers for.** Same shape: the department on the supervisor row is the primary link, further links let a Station Manager answer for Commercial and Operating alike |
| `supervisor_coverage` | Explicit responsibility: supervisor × station × unit (or unit kind, or item group) with a priority. Read first by the assignment engine |
| `audit_log` | User, role, action, entity, previous value, new value, IP, user agent, timestamp |

## Inspection catalogue

| Table | Purpose |
| --- | --- |
| `modules` | The three inspection streams |
| `inspection_types` | Passenger Amenities, Commercial, Safe Running, Station, Train, Section, Surprise, Routine, Special, Joint, Follow-up, Compliance, Thematic, Other |
| `item_groups` | Headings within a module (Water &amp; Sanitation, Ticketing, "A. Passenger Entry/Exit &amp; Boarding", …). `applies_to_kinds` names the kinds of area the group belongs to, so the inspection sheet offers the ticketing checks in the booking office and not on a platform; empty means it applies everywhere, which is right for the amenity groups |
| `inspection_items` | The amenity, service or inspection item, with its default department, category, severity and rule reference |
| `item_parameters` | Available, Functional, Clean, Adequate, Accessible, Properly displayed, Properly maintained, Safe for passenger use, Requires repair, Requires replacement, Not available, Not functional, Not applicable |
| `item_parameter_map` | Which parameters apply to which item (administrator configurable) |
| `item_deficiencies` | **Suggested deficiencies** - the "what usually fails" dropdown. Each row is scoped by the narrowest of `item_id`, `group_id` and `module_id` that is set; all three `NULL` makes it generic, and `{item}` in the text is replaced with the item's name when it is served. A suggestion may carry its own department, severity, category and TDC window |
| `observation_categories`, `severities` | Observation classification; severity carries its definition, default TDC window and whether it notifies or escalates immediately |
| `rule_references` | Railway Board and zonal instructions, for rule linking |
| `contractors` | Contractors, licensees and vendors with contract reference and validity |

## Rule engine

| Table | Purpose |
| --- | --- |
| `tdc_rules` | Per severity: reminder before due, reminder on due date, overdue repeat interval, escalation threshold and target role |
| `notification_rules` | Per event: recipients (`supervisor`, `inspector`, `reporting_officer`, `role:<role>`, `escalation:<n>`), channels and `{{placeholder}}` templates |
| `escalation_levels` | Level, days past TDC, target role and designation |
| `settings` | Key/value application settings |

## Transactions

| Table | Purpose |
| --- | --- |
| `inspections` | Reference number, office report number, module, type, `scope` (station / train / section), location, inspector, clock times, the predecessor link, status, report status, summary, general remarks, QR token, `client_uuid` for offline idempotency |
| `inspection_areas` | **The sheet.** One row per area the inspection covers, created when the inspection starts. `result` is `satisfactory`, `deficiencies`, `not_inspected` or `not_available`, so the record can tell an area found in order from one nobody looked at |
| `inspection_item_results` | What was checked inside an area and how it was found (`ok` / `deficient` / `not_applicable`), with the observation it produced. This is what lets a report print the items found in order rather than only the deficiencies |
| `inspection_previous_reviews` | The review of what the previous inspection of that place left outstanding, which is how every real inspection opens. The finding is recorded here and mirrored onto the observation's timeline; it never edits the observation |
| `observations` | The core record. Denormalised `unit_name` and `item_name` snapshots keep history readable after a master is renamed; `deficiency_id` records which suggestion the inspector started from, which is what makes "most reported deficiencies" a count rather than a text match. An inspection carries as many observations as the inspection found |
| `attachments` | Photographs, video, documents and signatures, tagged by phase (observation, compliance, verification) |
| `compliances` | One row per compliance round, with its verification outcome, so nothing is overwritten |
| `observation_events` | The immutable timeline: action, from status, to status, actor, remarks |
| `approvals` | Inspector, supervisor and officer acknowledgements with digital signatures |
| `notifications`, `notification_deliveries` | The message and one row per channel attempt with its status |
| `reminder_log` | Guard table: unique on (observation, kind, level, date), which makes the daily sweep idempotent |
| `report_tokens` | QR verification tokens for generated reports |
| `inspection_notes` | **The letter.** Number, date, subject, addressee, the standing paragraphs, signatory and copy-to, with its own verification token. Stored rather than rendered on demand, because a note is a record: its wording is fixed once issued |
| `inspection_note_observations` | Which observations a note compiles, and in what order they are numbered |

## Derived fields

Two views, `v_observations` and `v_inspections`, join the reference data and compute:

| Field | Definition |
| --- | --- |
| `is_overdue` | TDC has passed **and** the status is one where the department still owes an action. `closed`, `cancelled`, `verified` and `compliance_submitted` are never overdue |
| `is_open` | Status is not `closed` or `cancelled` |
| `days_to_tdc` | Signed day count to the TDC; negative when overdue |
| `attachment_count`, `observation_count`, `open_count`, `closed_count`, `critical_count` | Roll-ups used by lists and dashboards |
| `areas_on_sheet`, `areas_covered`, `areas_satisfactory`, `areas_with_deficiencies`, `areas_not_inspected`, `areas_not_available` | How much of the place the visit covered, read from `inspection_areas` |
| `coverage_pct` | Areas attended to as a percentage of the areas that exist there. An area recorded as not available is left out of the denominator rather than counted against the officer |
| `items_checked`, `items_ok`, `items_deficient` | Roll-ups of `inspection_item_results` |
| `previous_reviewed`, `previous_complied`, `previous_outstanding`, `previous_ref_no` | The position on what the last inspection of that place left behind |

Coverage lives in the view for the same reason overdue does: every report, dashboard and screen
then reads the same numbers, and none of them can drift from the sheet.

Overdue is deliberately **not** a stored status. Storing it would mean a scheduled job could leave
it stale; deriving it means the badge is always right.

## Status model

Workflow statuses: `submitted` → `assigned` → `acknowledged` → `in_progress` →
`compliance_submitted` → `verified` → `closed`.
Alternate outcomes: `rejected`, `reopened`, `cancelled`.
Overdue is a derived flag shown alongside the status, not a status of its own.
