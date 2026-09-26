# Data model

SQLite, defined in [`server/src/db/schema.sql`](../server/src/db/schema.sql). Timestamps are
ISO-8601 UTC strings; plain dates are `YYYY-MM-DD`. Foreign keys are enforced.

## Organisation and location

| Table | Purpose |
| --- | --- |
| `zones`, `divisions` | Railway organisation |
| `departments` | The "Action By" list, including external parties (contractor, licensee, vendor) |
| `stations` | Code, name, division, zone, category, type, platforms, coordinates |
| `trains` | Number, name, origin, destination, type, pantry |
| `units` | Units and areas. `station_id IS NULL` makes the unit a template available at every station; `applies_to` separates station areas from train areas |

## People and access

| Table | Purpose |
| --- | --- |
| `users` | Employee ID, role, department, division, station, password hash, lockout state |
| `sessions` | One row per sign-in, so sessions can time out and be revoked centrally |
| `otp_codes` | Hashed one-time passwords with expiry and attempt count |
| `supervisors` | **Concerned Supervisor Master**: employee ID, designation, department, sub-department, station, section, area of responsibility, mobile, email, reporting officer, linked user |
| `supervisor_coverage` | Explicit responsibility: supervisor × station × unit (or unit kind, or item group) with a priority. Read first by the assignment engine |
| `audit_log` | User, role, action, entity, previous value, new value, IP, user agent, timestamp |

## Inspection catalogue

| Table | Purpose |
| --- | --- |
| `modules` | The three inspection streams |
| `inspection_types` | Passenger Amenities, Commercial, Safe Running, Station, Train, Section, Surprise, Routine, Special, Joint, Follow-up, Compliance, Thematic, Other |
| `item_groups` | Headings within a module (Water &amp; Sanitation, Ticketing, "A. Passenger Entry/Exit &amp; Boarding", …) |
| `inspection_items` | The amenity, service or inspection item, with its default department, category, severity and rule reference |
| `item_parameters` | Available, Functional, Clean, Adequate, Accessible, Properly displayed, Properly maintained, Safe for passenger use, Requires repair, Requires replacement, Not available, Not functional, Not applicable |
| `item_parameter_map` | Which parameters apply to which item (administrator configurable) |
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
| `inspections` | Reference number, module, type, location, inspector, status, summary, QR token, `client_uuid` for offline idempotency |
| `observations` | The core record. Denormalised `unit_name` and `item_name` snapshots keep history readable after a master is renamed |
| `attachments` | Photographs, video, documents and signatures, tagged by phase (observation, compliance, verification) |
| `compliances` | One row per compliance round, with its verification outcome, so nothing is overwritten |
| `observation_events` | The immutable timeline: action, from status, to status, actor, remarks |
| `approvals` | Inspector, supervisor and officer acknowledgements with digital signatures |
| `notifications`, `notification_deliveries` | The message and one row per channel attempt with its status |
| `reminder_log` | Guard table: unique on (observation, kind, level, date), which makes the daily sweep idempotent |
| `report_tokens` | QR verification tokens for generated reports |

## Derived fields

Two views, `v_observations` and `v_inspections`, join the reference data and compute:

| Field | Definition |
| --- | --- |
| `is_overdue` | TDC has passed **and** the status is one where the department still owes an action. `closed`, `cancelled`, `verified` and `compliance_submitted` are never overdue |
| `is_open` | Status is not `closed` or `cancelled` |
| `days_to_tdc` | Signed day count to the TDC; negative when overdue |
| `attachment_count`, `observation_count`, `open_count`, `closed_count`, `critical_count` | Roll-ups used by lists and dashboards |

Overdue is deliberately **not** a stored status. Storing it would mean a scheduled job could leave
it stale; deriving it means the badge is always right.

## Status model

Workflow statuses: `submitted` → `assigned` → `acknowledged` → `in_progress` →
`compliance_submitted` → `verified` → `closed`.
Alternate outcomes: `rejected`, `reopened`, `cancelled`.
Overdue is a derived flag shown alongside the status, not a status of its own.
