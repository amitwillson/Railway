-- ===========================================================================
--  Railway Commercial, Passenger Amenities & Safe Running
--  Inspection & Compliance Management System
--  SQLite schema
-- ===========================================================================
--  Design notes
--  * All timestamps are ISO-8601 UTC strings (YYYY-MM-DDTHH:MM:SS.sssZ).
--  * All plain dates are ISO-8601 local dates (YYYY-MM-DD).
--  * Master data is fully table driven: no application code change is needed
--    to add a station, unit, amenity, department, supervisor or rule.
--  * Observation "overdue" is NOT a stored status. It is derived from
--    (tdc < today AND status is an open status) so that it can never drift out
--    of sync with the workflow status. Stored statuses follow the workflow.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. Organisation masters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS zones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS divisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  zone_id     INTEGER NOT NULL REFERENCES zones(id),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_divisions_zone ON divisions(zone_id);

-- Sections of the division. `stations.section` carries the code rather than a
-- foreign key, because the station list is replaced wholesale from a CSV that
-- names the section in text; this table gives the code its full name and orders
-- the sections for the filters.
CREATE TABLE IF NOT EXISTS sections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  division_id INTEGER REFERENCES divisions(id),
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  is_external INTEGER NOT NULL DEFAULT 0,   -- contractor / licensee / vendor
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  division_id  INTEGER NOT NULL REFERENCES divisions(id),
  zone_id      INTEGER NOT NULL REFERENCES zones(id),
  category     TEXT,                 -- NSG-1 .. NSG-6, SG-1 .., HG-1 ..
  station_type TEXT,                 -- Junction / Terminal / Halt / Flag ...
  section      TEXT,                 -- section code, e.g. JSG-BSP (see sections)
  platforms    INTEGER NOT NULL DEFAULT 0,
  state        TEXT,
  district     TEXT,
  route        TEXT,                 -- route classification (A, B, D spl, ...)
  km           REAL,                 -- chainage, which orders a section
  latitude     REAL,
  longitude    REAL,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_stations_division ON stations(division_id);
CREATE INDEX IF NOT EXISTS idx_stations_name ON stations(name);

-- What a station actually has, as recorded in PAMS. One row per station, kept
-- apart from `stations` because it is a periodic extract from the divisional
-- record rather than something this system maintains: it tells an inspecting
-- officer what should be there before they go, and the station page shows it as
-- the position of record with the date it was last updated in PAMS.
CREATE TABLE IF NOT EXISTS station_facilities (
  station_id               INTEGER PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
  passengers_per_day       INTEGER NOT NULL DEFAULT 0,
  max_passengers_at_a_time INTEGER NOT NULL DEFAULT 0,
  trains_mail_express      INTEGER NOT NULL DEFAULT 0,
  trains_passenger         INTEGER NOT NULL DEFAULT 0,
  booking_windows          INTEGER NOT NULL DEFAULT 0,
  uts_counters             INTEGER NOT NULL DEFAULT 0,
  prs_counter              INTEGER NOT NULL DEFAULT 0,
  enquiry_counters         INTEGER NOT NULL DEFAULT 0,
  atm_count                INTEGER NOT NULL DEFAULT 0,
  food_plaza               INTEGER NOT NULL DEFAULT 0,
  refreshment_room         INTEGER NOT NULL DEFAULT 0,
  base_kitchen             INTEGER NOT NULL DEFAULT 0,
  cloak_room               INTEGER NOT NULL DEFAULT 0,
  parcel_facility          INTEGER NOT NULL DEFAULT 0,
  ac_retiring_rooms        INTEGER NOT NULL DEFAULT 0,
  non_ac_retiring_rooms    INTEGER NOT NULL DEFAULT 0,
  waiting_hall_area_sqm    REAL NOT NULL DEFAULT 0,
  waiting_hall_seats       INTEGER NOT NULL DEFAULT 0,
  foot_over_bridges        INTEGER NOT NULL DEFAULT 0,
  subways                  INTEGER NOT NULL DEFAULT 0,
  second_entry             INTEGER NOT NULL DEFAULT 0,
  pa_system                INTEGER NOT NULL DEFAULT 0,
  train_indication_board   INTEGER NOT NULL DEFAULT 0,
  station_clock            INTEGER NOT NULL DEFAULT 0,
  rpf_post                 INTEGER NOT NULL DEFAULT 0,
  grp_post                 INTEGER NOT NULL DEFAULT 0,
  water_source             TEXT,
  water_supply_type        TEXT,
  wheelchair               INTEGER NOT NULL DEFAULT 0,
  divyangjan_toilet        INTEGER NOT NULL DEFAULT 0,
  divyangjan_ramp          INTEGER NOT NULL DEFAULT 0,
  divyangjan_water_tap     INTEGER NOT NULL DEFAULT 0,
  escalator_or_lift        INTEGER NOT NULL DEFAULT 0,
  braille_signage          INTEGER NOT NULL DEFAULT 0,
  aen_unit                 TEXT,     -- Assistant Engineer's unit, from PAMS
  iow_unit                 TEXT,     -- Inspector of Works' unit, from PAMS
  remarks                  TEXT,
  pams_updated_on          TEXT,
  pams_updated_by          TEXT,
  updated_at               TEXT
);

-- Minimum Essential Amenities: what is provided against what the norm requires.
-- The New Inspection screen shows the line for the item being inspected, so the
-- officer sees the norm at the moment of recording. `item_id` is resolved where
-- the norm item matches an inspection item by name; the label is kept either way.
CREATE TABLE IF NOT EXISTS station_amenity_norms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  item_id    INTEGER REFERENCES inspection_items(id) ON DELETE SET NULL,
  item_label TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'nos',   -- nos | sqm | yes/no
  provided   REAL NOT NULL DEFAULT 0,
  required   REAL NOT NULL DEFAULT 0,
  source     TEXT,                          -- where the figures came from
  updated_at TEXT,
  UNIQUE (station_id, item_label)
);
CREATE INDEX IF NOT EXISTS idx_norms_station ON station_amenity_norms(station_id);
CREATE INDEX IF NOT EXISTS idx_norms_item ON station_amenity_norms(item_id);

CREATE TABLE IF NOT EXISTS trains (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  number       TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  origin_code  TEXT,
  origin       TEXT,
  destination_code TEXT,
  destination  TEXT,
  train_type   TEXT,                 -- Mail/Express, Superfast, MEMU, Vande Bharat ...
  has_pantry   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_trains_name ON trains(name);

-- Units / areas. station_id NULL means the unit is a template available for
-- every station (or every train, per applies_to).
CREATE TABLE IF NOT EXISTS units (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  applies_to  TEXT NOT NULL DEFAULT 'station'
              CHECK (applies_to IN ('station','train','both')),
  station_id  INTEGER REFERENCES stations(id) ON DELETE CASCADE,
  kind        TEXT,                  -- platform / hall / office / coach ...
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_units_station ON units(station_id);
CREATE INDEX IF NOT EXISTS idx_units_applies ON units(applies_to);

-- ---------------------------------------------------------------------------
-- 2. Users, roles, sessions, audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id    TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  designation    TEXT,
  role           TEXT NOT NULL CHECK (role IN
                   ('admin','divisional_officer','inspector','supervisor','viewer')),
  email          TEXT UNIQUE,
  mobile         TEXT,
  password_hash  TEXT NOT NULL,
  department_id  INTEGER REFERENCES departments(id),
  division_id    INTEGER REFERENCES divisions(id),
  zone_id        INTEGER REFERENCES zones(id),
  station_id     INTEGER REFERENCES stations(id),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  last_login_at  TEXT,
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_division ON users(division_id);

-- One-time passwords for OTP login
CREATE TABLE IF NOT EXISTS otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'sms',
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_user ON otp_codes(user_id);

-- Refresh/session records so sessions can time out and be revoked centrally
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,                -- jti
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  last_seen_at TEXT,
  ip          TEXT,
  user_agent  TEXT,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  user_name     TEXT,
  role          TEXT,
  action        TEXT NOT NULL,         -- OBSERVATION_CREATE, MASTER_UPDATE ...
  entity_type   TEXT,
  entity_id     TEXT,
  previous_value TEXT,                 -- JSON
  new_value     TEXT,                  -- JSON
  remarks       TEXT,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);

-- ---------------------------------------------------------------------------
-- 3. Supervisor master (auto-assignment source of truth)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supervisors (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id          TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  designation          TEXT,
  department_id        INTEGER NOT NULL REFERENCES departments(id),
  sub_department       TEXT,
  station_id           INTEGER REFERENCES stations(id),
  section              TEXT,
  area_of_responsibility TEXT,          -- free text, matched against unit name
  mobile               TEXT,
  email                TEXT,
  reporting_officer_id INTEGER REFERENCES supervisors(id),
  user_id              INTEGER REFERENCES users(id),
  is_default_for_department INTEGER NOT NULL DEFAULT 0,
  active               INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_sup_dept ON supervisors(department_id);
CREATE INDEX IF NOT EXISTS idx_sup_station ON supervisors(station_id);

-- Explicit responsibility mapping: station + unit + department -> supervisor.
-- Used first by the auto-assignment engine; falls back to station/department.
CREATE TABLE IF NOT EXISTS supervisor_coverage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supervisor_id INTEGER NOT NULL REFERENCES supervisors(id) ON DELETE CASCADE,
  station_id    INTEGER REFERENCES stations(id) ON DELETE CASCADE,
  unit_id       INTEGER REFERENCES units(id) ON DELETE CASCADE,
  unit_kind     TEXT,
  item_group_id INTEGER,
  priority      INTEGER NOT NULL DEFAULT 100,   -- lower wins
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_cov_sup ON supervisor_coverage(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_cov_station ON supervisor_coverage(station_id);

-- A supervisor is linked to the stations AND the departments they answer for.
-- supervisors.station_id / supervisors.department_id remain the primary posting
-- (one row each, mirrored here with is_primary = 1) so that existing reports and
-- screens keep working; these two tables carry the additional links, which is
-- what lets one SSE cover a whole section, or a Station Manager answer for both
-- Commercial and Operating.
CREATE TABLE IF NOT EXISTS supervisor_stations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supervisor_id INTEGER NOT NULL REFERENCES supervisors(id) ON DELETE CASCADE,
  station_id    INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  is_primary    INTEGER NOT NULL DEFAULT 0,
  section       TEXT,
  priority      INTEGER NOT NULL DEFAULT 100,   -- lower wins within a station
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (supervisor_id, station_id)
);
CREATE INDEX IF NOT EXISTS idx_sup_stn_sup ON supervisor_stations(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_sup_stn_stn ON supervisor_stations(station_id);

CREATE TABLE IF NOT EXISTS supervisor_departments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supervisor_id INTEGER NOT NULL REFERENCES supervisors(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  is_primary    INTEGER NOT NULL DEFAULT 0,
  priority      INTEGER NOT NULL DEFAULT 100,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (supervisor_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_sup_dep_sup ON supervisor_departments(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_sup_dep_dep ON supervisor_departments(department_id);

-- ---------------------------------------------------------------------------
-- 4. Inspection masters (modules, types, items, parameters)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS modules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,   -- PA | CI | SR
  name        TEXT NOT NULL,
  tagline     TEXT,
  description TEXT,
  accent      TEXT,                   -- UI accent token
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS inspection_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  module_id   INTEGER REFERENCES modules(id),   -- NULL = usable by all modules
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1
);

-- Group = the heading an inspection item sits under, e.g.
-- "Water & Sanitation", "Ticketing", "A. Passenger Entry/Exit & Boarding"
CREATE TABLE IF NOT EXISTS item_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id   INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Comma-separated unit kinds this group belongs to, e.g. 'booking office,
  -- reservation office'. NULL or empty means the group applies in every area.
  -- The inspection sheet reads it so that a platform is not offered the
  -- booking-office checks; it is master data, editable from the admin panel.
  applies_to_kinds TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (module_id, name)
);

CREATE TABLE IF NOT EXISTS inspection_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id              INTEGER NOT NULL REFERENCES item_groups(id) ON DELETE CASCADE,
  module_id             INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  applies_to            TEXT NOT NULL DEFAULT 'both'
                        CHECK (applies_to IN ('station','train','both')),
  default_department_id INTEGER REFERENCES departments(id),
  default_category_id   INTEGER,
  default_severity_id   INTEGER,
  rule_reference_id     INTEGER,
  sort_order            INTEGER NOT NULL DEFAULT 100,
  active                INTEGER NOT NULL DEFAULT 1,
  UNIQUE (group_id, name)
);
CREATE INDEX IF NOT EXISTS idx_items_module ON inspection_items(module_id);
CREATE INDEX IF NOT EXISTS idx_items_group ON inspection_items(group_id);

CREATE TABLE IF NOT EXISTS item_parameters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,   -- Available / Functional / Clean ...
  polarity    TEXT NOT NULL DEFAULT 'positive'
              CHECK (polarity IN ('positive','negative','neutral')),
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1
);

-- Admin-configurable: which parameters apply to which item
CREATE TABLE IF NOT EXISTS item_parameter_map (
  item_id      INTEGER NOT NULL REFERENCES inspection_items(id) ON DELETE CASCADE,
  parameter_id INTEGER NOT NULL REFERENCES item_parameters(id) ON DELETE CASCADE,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (item_id, parameter_id)
);

-- Suggested deficiencies ("what usually fails") offered as a dropdown under the
-- observation box, so the inspector picks the common wording instead of typing it.
-- A row is scoped by the narrowest of item_id, group_id and module_id that is set;
-- a row with all three NULL is offered for every item. {item} in the text is
-- replaced with the item's name when the row is served, which is what lets one
-- row read correctly under two hundred different items.
CREATE TABLE IF NOT EXISTS item_deficiencies (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id               INTEGER REFERENCES inspection_items(id) ON DELETE CASCADE,
  group_id              INTEGER REFERENCES item_groups(id) ON DELETE CASCADE,
  module_id             INTEGER REFERENCES modules(id) ON DELETE CASCADE,
  text                  TEXT NOT NULL,
  default_severity_id   INTEGER REFERENCES severities(id),
  default_department_id INTEGER REFERENCES departments(id),
  default_category_id   INTEGER,
  suggested_tdc_days    INTEGER,
  sort_order            INTEGER NOT NULL DEFAULT 100,
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_defic_item ON item_deficiencies(item_id);
CREATE INDEX IF NOT EXISTS idx_defic_group ON item_deficiencies(group_id);
CREATE INDEX IF NOT EXISTS idx_defic_module ON item_deficiencies(module_id);

CREATE TABLE IF NOT EXISTS observation_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS severities (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL UNIQUE,   -- Critical / Major / Moderate / Minor
  definition            TEXT,
  rank                  INTEGER NOT NULL,       -- 1 = most severe
  default_tdc_days      INTEGER,
  notify_immediately    INTEGER NOT NULL DEFAULT 0,
  escalate_immediately  INTEGER NOT NULL DEFAULT 0,
  accent                TEXT,
  active                INTEGER NOT NULL DEFAULT 1
);

-- Railway Board / zonal instruction library for rule linking
CREATE TABLE IF NOT EXISTS rule_references (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  authority     TEXT,
  reference_no  TEXT,
  issued_on     TEXT,
  url           TEXT,
  notes         TEXT,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS contractors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  party_type    TEXT NOT NULL DEFAULT 'contractor'
                CHECK (party_type IN ('contractor','licensee','vendor')),
  contract_ref  TEXT,
  scope         TEXT,
  station_id    INTEGER REFERENCES stations(id),
  department_id INTEGER REFERENCES departments(id),
  contact_person TEXT,
  mobile        TEXT,
  email         TEXT,
  valid_from    TEXT,
  valid_to      TEXT,
  security_deposit REAL,
  licence_fee   REAL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_contractors_station ON contractors(station_id);

-- ---------------------------------------------------------------------------
-- 5. Rule engine masters: TDC reminders, notifications, escalation
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tdc_rules (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT NOT NULL,
  severity_id            INTEGER REFERENCES severities(id),  -- NULL = default
  remind_before_days     INTEGER NOT NULL DEFAULT 2,
  remind_on_due_date     INTEGER NOT NULL DEFAULT 1,
  overdue_repeat_days    INTEGER NOT NULL DEFAULT 3,
  escalate_after_days    INTEGER NOT NULL DEFAULT 7,
  escalate_to_role       TEXT NOT NULL DEFAULT 'divisional_officer',
  active                 INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event          TEXT NOT NULL,        -- OBSERVATION_ASSIGNED, TDC_REMINDER ...
  recipients     TEXT NOT NULL,        -- JSON: ["supervisor","inspector","role:admin"]
  in_app         INTEGER NOT NULL DEFAULT 1,
  email          INTEGER NOT NULL DEFAULT 1,
  sms            INTEGER NOT NULL DEFAULT 0,
  template_title TEXT,
  template_body  TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (event)
);

CREATE TABLE IF NOT EXISTS escalation_levels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level        INTEGER NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  after_days   INTEGER NOT NULL,       -- days past TDC
  target_role  TEXT NOT NULL,
  target_designation TEXT,
  notes        TEXT,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  value_type  TEXT NOT NULL DEFAULT 'string',
  label       TEXT,
  category    TEXT,
  updated_at  TEXT,
  updated_by  INTEGER REFERENCES users(id)
);

-- ---------------------------------------------------------------------------
-- 6. Inspections and observations
-- ---------------------------------------------------------------------------

-- An inspection is one visit by one inspecting officer, covering as many areas
-- of the station (or coaches of the train) as that officer attends to. It is the
-- unit of record: the areas covered live in inspection_areas, the item-by-item
-- result in inspection_item_results, and the deficiencies in observations. The
-- areas are part of the inspection, never the other way round, which is why
-- `scope` says station / train / section and never names an area. `location_type`
-- is kept because earlier records carry it and the admin filters read it, but it
-- no longer decides what an inspection is.
CREATE TABLE IF NOT EXISTS inspections (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_no             TEXT NOT NULL UNIQUE,
  inspection_no      TEXT,             -- office running number, FY series
  module_id          INTEGER NOT NULL REFERENCES modules(id),
  inspection_type_id INTEGER NOT NULL REFERENCES inspection_types(id),
  scope              TEXT NOT NULL DEFAULT 'station'
                     CHECK (scope IN ('station','train','section')),
  location_type      TEXT NOT NULL,
  station_id         INTEGER REFERENCES stations(id),
  train_id           INTEGER REFERENCES trains(id),
  section            TEXT,
  title              TEXT,
  inspector_id       INTEGER NOT NULL REFERENCES users(id),
  joint_with         TEXT,             -- officers and staff who accompanied
  planned_date       TEXT,
  started_at         TEXT,
  completed_at       TEXT,
  from_time          TEXT,             -- HH:MM, the clock time of the visit
  to_time            TEXT,
  previous_inspection_id INTEGER REFERENCES inspections(id),
  status             TEXT NOT NULL DEFAULT 'in_progress'
                     CHECK (status IN ('planned','in_progress','completed','cancelled')),
  report_status      TEXT NOT NULL DEFAULT 'draft'
                     CHECK (report_status IN ('draft','issued')),
  report_issued_at   TEXT,
  report_issued_by   INTEGER REFERENCES users(id),
  summary            TEXT,
  auto_summary       TEXT,
  general_remarks    TEXT,             -- good work noticed, staff alertness, etc.
  notes              TEXT,
  latitude           REAL,
  longitude          REAL,
  qr_token           TEXT UNIQUE,
  client_uuid        TEXT UNIQUE,      -- offline idempotency key
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_insp_station ON inspections(station_id);
CREATE INDEX IF NOT EXISTS idx_insp_train ON inspections(train_id);
CREATE INDEX IF NOT EXISTS idx_insp_inspector ON inspections(inspector_id);
CREATE INDEX IF NOT EXISTS idx_insp_module ON inspections(module_id);
CREATE INDEX IF NOT EXISTS idx_insp_created ON inspections(created_at);
CREATE INDEX IF NOT EXISTS idx_insp_previous ON inspections(previous_inspection_id);

-- The areas this inspection attended to. One row per area, created when the
-- inspector opens the inspection sheet, so the record distinguishes an area
-- found satisfactory from one never looked at - which is the difference between
-- an inspection report and a list of complaints.
--   satisfactory   checked, nothing to report
--   deficiencies   checked, one or more observations raised (set automatically)
--   not_inspected  on the sheet, not attended to on this visit
--   not_available  the area does not exist / was closed at the time
CREATE TABLE IF NOT EXISTS inspection_areas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  unit_id       INTEGER REFERENCES units(id),
  unit_name     TEXT NOT NULL,          -- snapshot, so a renamed unit cannot rewrite history
  unit_kind     TEXT,
  coach         TEXT,                   -- for a train inspection
  result        TEXT NOT NULL DEFAULT 'not_inspected'
                CHECK (result IN ('satisfactory','deficiencies','not_inspected','not_available')),
  remarks       TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 100,
  inspected_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT,
  UNIQUE (inspection_id, unit_id, coach)
);
CREATE INDEX IF NOT EXISTS idx_insp_areas_inspection ON inspection_areas(inspection_id);
CREATE INDEX IF NOT EXISTS idx_insp_areas_unit ON inspection_areas(unit_id);

-- Item-by-item result inside an area. This is what lets the report print
-- "Drinking Water - checked, in order" beside "Water Cooler - deficient, see
-- OBS/2026/0043", instead of silently omitting everything that was found right.
CREATE TABLE IF NOT EXISTS inspection_item_results (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id      INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  inspection_area_id INTEGER REFERENCES inspection_areas(id) ON DELETE CASCADE,
  unit_id            INTEGER REFERENCES units(id),
  item_id            INTEGER REFERENCES inspection_items(id),
  item_name          TEXT NOT NULL,     -- snapshot
  group_name         TEXT,
  result             TEXT NOT NULL DEFAULT 'ok'
                     CHECK (result IN ('ok','deficient','not_applicable')),
  parameters         TEXT,              -- JSON [{parameter_id,name,value}]
  remarks            TEXT,
  observation_id     INTEGER REFERENCES observations(id) ON DELETE SET NULL,
  recorded_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (inspection_id, inspection_area_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_insp_items_inspection ON inspection_item_results(inspection_id);
CREATE INDEX IF NOT EXISTS idx_insp_items_area ON inspection_item_results(inspection_area_id);
CREATE INDEX IF NOT EXISTS idx_insp_items_obs ON inspection_item_results(observation_id);

-- Review of the previous inspection's outstanding observations, which is how
-- every real inspection opens. The finding is recorded here and mirrored onto
-- the observation's own timeline; it never edits the observation's wording.
CREATE TABLE IF NOT EXISTS inspection_previous_reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id  INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  finding        TEXT NOT NULL
                 CHECK (finding IN ('complied','partially_complied','not_complied','dropped')),
  remarks        TEXT,
  reviewed_by    INTEGER REFERENCES users(id),
  reviewed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (inspection_id, observation_id)
);
CREATE INDEX IF NOT EXISTS idx_insp_prev_inspection ON inspection_previous_reviews(inspection_id);
CREATE INDEX IF NOT EXISTS idx_insp_prev_obs ON inspection_previous_reviews(observation_id);

CREATE TABLE IF NOT EXISTS observations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_no                TEXT NOT NULL UNIQUE,
  inspection_id         INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  inspection_area_id    INTEGER REFERENCES inspection_areas(id) ON DELETE SET NULL,
  module_id             INTEGER NOT NULL REFERENCES modules(id),
  station_id            INTEGER REFERENCES stations(id),
  train_id              INTEGER REFERENCES trains(id),
  coach                 TEXT,
  unit_id               INTEGER REFERENCES units(id),
  unit_name             TEXT,           -- denormalised snapshot
  item_id               INTEGER REFERENCES inspection_items(id),
  item_name             TEXT,           -- denormalised snapshot
  deficiency_id         INTEGER REFERENCES item_deficiencies(id),
  parameters            TEXT,           -- JSON [{parameter_id,name,value}]
  observation           TEXT NOT NULL,
  category_id           INTEGER REFERENCES observation_categories(id),
  severity_id           INTEGER NOT NULL REFERENCES severities(id),
  action_by_department_id INTEGER NOT NULL REFERENCES departments(id),
  supervisor_id         INTEGER REFERENCES supervisors(id),
  assignment_mode       TEXT DEFAULT 'auto'
                        CHECK (assignment_mode IN ('auto','manual','unassigned')),
  contractor_id         INTEGER REFERENCES contractors(id),
  rule_reference_id     INTEGER REFERENCES rule_references(id),
  tdc                   TEXT,           -- nullable: TDC is optional
  status                TEXT NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('submitted','assigned','acknowledged',
                          'in_progress','compliance_submitted','verified','closed',
                          'rejected','reopened','cancelled')),
  requires_physical_verification INTEGER NOT NULL DEFAULT 0,
  repeat_count          INTEGER NOT NULL DEFAULT 0,
  repeat_of_id          INTEGER REFERENCES observations(id),
  escalation_level      INTEGER NOT NULL DEFAULT 0,
  reopen_count          INTEGER NOT NULL DEFAULT 0,
  cancel_reason         TEXT,
  latitude              REAL,
  longitude             REAL,
  created_by            INTEGER NOT NULL REFERENCES users(id),
  observed_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  assigned_at           TEXT,
  acknowledged_at       TEXT,
  compliance_submitted_at TEXT,
  verified_at           TEXT,
  closed_at             TEXT,
  closed_by             INTEGER REFERENCES users(id),
  client_uuid           TEXT UNIQUE,    -- offline idempotency key
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_obs_inspection ON observations(inspection_id);
CREATE INDEX IF NOT EXISTS idx_obs_station ON observations(station_id);
CREATE INDEX IF NOT EXISTS idx_obs_status ON observations(status);
CREATE INDEX IF NOT EXISTS idx_obs_dept ON observations(action_by_department_id);
CREATE INDEX IF NOT EXISTS idx_obs_sup ON observations(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_obs_module ON observations(module_id);
CREATE INDEX IF NOT EXISTS idx_obs_tdc ON observations(tdc);
CREATE INDEX IF NOT EXISTS idx_obs_created_by ON observations(created_by);
CREATE INDEX IF NOT EXISTS idx_obs_item ON observations(item_id);

CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER REFERENCES observations(id) ON DELETE CASCADE,
  inspection_id  INTEGER REFERENCES inspections(id) ON DELETE CASCADE,
  compliance_id  INTEGER,
  kind          TEXT NOT NULL DEFAULT 'photo'
                CHECK (kind IN ('photo','video','document','signature')),
  phase         TEXT NOT NULL DEFAULT 'observation'
                CHECK (phase IN ('observation','compliance','verification')),
  file_name     TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER,
  caption       TEXT,
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_att_obs ON attachments(observation_id);
CREATE INDEX IF NOT EXISTS idx_att_insp ON attachments(inspection_id);

CREATE TABLE IF NOT EXISTS compliances (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id  INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  round           INTEGER NOT NULL DEFAULT 1,
  supervisor_id   INTEGER REFERENCES supervisors(id),
  submitted_by    INTEGER NOT NULL REFERENCES users(id),
  action_taken    TEXT NOT NULL,
  remarks         TEXT,
  compliance_date TEXT NOT NULL,
  expenditure     REAL,
  status          TEXT NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted','accepted','rejected',
                                    'physical_verification_required')),
  verified_by     INTEGER REFERENCES users(id),
  verified_at     TEXT,
  verification_remarks TEXT,
  rejection_reason TEXT,
  submitted_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comp_obs ON compliances(observation_id);
CREATE INDEX IF NOT EXISTS idx_comp_status ON compliances(status);

-- Immutable timeline for every observation state change
CREATE TABLE IF NOT EXISTS observation_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  action         TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  actor_id       INTEGER REFERENCES users(id),
  actor_name     TEXT,
  actor_role     TEXT,
  remarks        TEXT,
  metadata       TEXT,                  -- JSON
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_oev_obs ON observation_events(observation_id);

-- Digital signature / acknowledgement records
CREATE TABLE IF NOT EXISTS approvals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('inspection','observation','compliance')),
  entity_id    INTEGER NOT NULL,
  approval_role TEXT NOT NULL,          -- inspector / supervisor / officer
  user_id      INTEGER NOT NULL REFERENCES users(id),
  user_name    TEXT,
  designation  TEXT,
  remarks      TEXT,
  signature_data TEXT,                  -- data URL of drawn signature
  signed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_appr_entity ON approvals(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 7. Notifications & reminders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event          TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT,
  observation_id INTEGER REFERENCES observations(id) ON DELETE CASCADE,
  inspection_id  INTEGER REFERENCES inspections(id) ON DELETE CASCADE,
  severity       TEXT,
  link           TEXT,
  read_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notif_obs ON notifications(observation_id);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('in_app','email','sms','push')),
  target          TEXT,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sent','failed','skipped')),
  provider        TEXT,
  error           TEXT,
  sent_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_deliv_notif ON notification_deliveries(notification_id);
CREATE INDEX IF NOT EXISTS idx_deliv_status ON notification_deliveries(status);

-- Guard table: one reminder of a given kind/level per observation per day
CREATE TABLE IF NOT EXISTS reminder_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,     -- before_due | on_due | overdue | escalation
  level          INTEGER NOT NULL DEFAULT 0,
  for_date       TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (observation_id, kind, level, for_date)
);

-- ---------------------------------------------------------------------------
-- 8. Reports & verification
-- ---------------------------------------------------------------------------

-- An Inspection Note is the letter that goes out after an inspection: several
-- observations compiled into one numbered, signed communication in the office
-- letter format. The note is a record in its own right - it keeps its number and
-- its wording even as the observations it cites move through the workflow - so it
-- is stored rather than rendered on the fly.
CREATE TABLE IF NOT EXISTS inspection_notes (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  note_no               TEXT NOT NULL UNIQUE,
  inspection_id         INTEGER REFERENCES inspections(id) ON DELETE SET NULL,
  module_id             INTEGER REFERENCES modules(id),
  station_id            INTEGER REFERENCES stations(id),
  train_id              INTEGER REFERENCES trains(id),
  letter_date           TEXT NOT NULL,
  subject               TEXT NOT NULL,
  addressee             TEXT,
  salutation            TEXT,
  preamble              TEXT,
  closing               TEXT,
  copy_to               TEXT,
  signatory_name        TEXT,
  signatory_designation TEXT,
  office                TEXT,
  letterhead            TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','issued','cancelled')),
  qr_token              TEXT UNIQUE,
  created_by            INTEGER NOT NULL REFERENCES users(id),
  issued_at             TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_inspection ON inspection_notes(inspection_id);
CREATE INDEX IF NOT EXISTS idx_notes_station ON inspection_notes(station_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_by ON inspection_notes(created_by);

-- Which observations the note compiles, and in which order they are numbered.
CREATE TABLE IF NOT EXISTS inspection_note_observations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id        INTEGER NOT NULL REFERENCES inspection_notes(id) ON DELETE CASCADE,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  sl_no          INTEGER NOT NULL DEFAULT 1,
  remarks        TEXT,
  UNIQUE (note_id, observation_id)
);
CREATE INDEX IF NOT EXISTS idx_note_obs_note ON inspection_note_observations(note_id);
CREATE INDEX IF NOT EXISTS idx_note_obs_obs ON inspection_note_observations(observation_id);

CREATE TABLE IF NOT EXISTS report_tokens (
  token        TEXT PRIMARY KEY,
  report_type  TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    INTEGER,
  params       TEXT,
  generated_by INTEGER REFERENCES users(id),
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- 9. Views used by dashboards / reports
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_observations;
CREATE VIEW v_observations AS
SELECT
  o.*,
  m.code       AS module_code,
  m.name       AS module_name,
  m.accent     AS module_accent,
  s.name       AS station_name,
  s.code       AS station_code,
  s.division_id AS division_id,
  s.section    AS station_section,
  d.name       AS division_name,
  z.code       AS zone_code,
  t.number     AS train_number,
  t.name       AS train_name,
  sev.name     AS severity_name,
  sev.rank     AS severity_rank,
  sev.accent   AS severity_accent,
  cat.name     AS category_name,
  dep.name     AS department_name,
  dep.code     AS department_code,
  sup.name     AS supervisor_name,
  sup.designation AS supervisor_designation,
  sup.mobile   AS supervisor_mobile,
  sup.email    AS supervisor_email,
  u.name       AS inspector_name,
  u.designation AS inspector_designation,
  i.ref_no     AS inspection_ref,
  it.name      AS inspection_type_name,
  -- Overdue is derived, never stored, so it can never drift from the status.
  -- An observation whose compliance has already been submitted is awaiting the
  -- inspecting officer, not the department, so it is not counted as overdue.
  CASE WHEN o.status IN ('closed','cancelled','verified','compliance_submitted') THEN 0
       WHEN o.tdc IS NULL THEN 0
       WHEN date(o.tdc) < date('now','localtime') THEN 1
       ELSE 0 END AS is_overdue,
  CASE WHEN o.status IN ('closed','cancelled') THEN 0 ELSE 1 END AS is_open,
  CASE WHEN o.tdc IS NULL THEN NULL
       ELSE CAST(julianday(date(o.tdc)) - julianday(date('now','localtime')) AS INTEGER)
  END AS days_to_tdc,
  (SELECT COUNT(*) FROM attachments a WHERE a.observation_id = o.id) AS attachment_count
FROM observations o
JOIN modules m       ON m.id = o.module_id
JOIN severities sev  ON sev.id = o.severity_id
JOIN departments dep ON dep.id = o.action_by_department_id
JOIN inspections i   ON i.id = o.inspection_id
JOIN inspection_types it ON it.id = i.inspection_type_id
JOIN users u         ON u.id = o.created_by
LEFT JOIN observation_categories cat ON cat.id = o.category_id
LEFT JOIN stations s ON s.id = o.station_id
LEFT JOIN divisions d ON d.id = s.division_id
LEFT JOIN zones z    ON z.id = s.zone_id
LEFT JOIN trains t   ON t.id = o.train_id
LEFT JOIN supervisors sup ON sup.id = o.supervisor_id;

DROP VIEW IF EXISTS v_inspections;
CREATE VIEW v_inspections AS
SELECT
  i.*,
  m.code AS module_code,
  m.name AS module_name,
  m.accent AS module_accent,
  it.name AS inspection_type_name,
  s.name AS station_name,
  s.code AS station_code,
  s.category AS station_category,
  d.name AS division_name,
  t.number AS train_number,
  t.name AS train_name,
  u.name AS inspector_name,
  u.designation AS inspector_designation,
  (SELECT COUNT(*) FROM observations o WHERE o.inspection_id = i.id) AS observation_count,
  (SELECT COUNT(*) FROM observations o WHERE o.inspection_id = i.id
     AND o.status NOT IN ('closed','cancelled')) AS open_count,
  (SELECT COUNT(*) FROM observations o WHERE o.inspection_id = i.id
     AND o.status = 'closed') AS closed_count,
  (SELECT COUNT(*) FROM observations o JOIN severities sv ON sv.id = o.severity_id
     WHERE o.inspection_id = i.id AND sv.rank = 1) AS critical_count,
  -- Coverage. An inspection is one visit over many areas, so how much of the
  -- station was attended to is a property of the inspection and belongs here,
  -- where every inspection-based report and dashboard reads it for free.
  (SELECT COUNT(*) FROM inspection_areas a WHERE a.inspection_id = i.id) AS areas_on_sheet,
  (SELECT COUNT(*) FROM inspection_areas a WHERE a.inspection_id = i.id
     AND a.result IN ('satisfactory','deficiencies')) AS areas_covered,
  (SELECT COUNT(*) FROM inspection_areas a WHERE a.inspection_id = i.id
     AND a.result = 'satisfactory') AS areas_satisfactory,
  (SELECT COUNT(*) FROM inspection_areas a WHERE a.inspection_id = i.id
     AND a.result = 'deficiencies') AS areas_with_deficiencies,
  (SELECT COUNT(*) FROM inspection_areas a WHERE a.inspection_id = i.id
     AND a.result = 'not_inspected') AS areas_not_inspected,
  (SELECT COUNT(*) FROM inspection_areas a WHERE a.inspection_id = i.id
     AND a.result = 'not_available') AS areas_not_available,
  CASE WHEN (SELECT COUNT(*) FROM inspection_areas a WHERE a.inspection_id = i.id
               AND a.result <> 'not_available') = 0 THEN NULL
       ELSE CAST(ROUND(
         100.0 * (SELECT COUNT(*) FROM inspection_areas a WHERE a.inspection_id = i.id
                    AND a.result IN ('satisfactory','deficiencies'))
         / (SELECT COUNT(*) FROM inspection_areas a WHERE a.inspection_id = i.id
              AND a.result <> 'not_available')) AS INTEGER)
  END AS coverage_pct,
  (SELECT COUNT(*) FROM inspection_item_results r WHERE r.inspection_id = i.id) AS items_checked,
  (SELECT COUNT(*) FROM inspection_item_results r WHERE r.inspection_id = i.id
     AND r.result = 'ok') AS items_ok,
  (SELECT COUNT(*) FROM inspection_item_results r WHERE r.inspection_id = i.id
     AND r.result = 'deficient') AS items_deficient,
  (SELECT COUNT(*) FROM inspection_previous_reviews pr WHERE pr.inspection_id = i.id) AS previous_reviewed,
  (SELECT COUNT(*) FROM inspection_previous_reviews pr WHERE pr.inspection_id = i.id
     AND pr.finding = 'complied') AS previous_complied,
  (SELECT COUNT(*) FROM inspection_previous_reviews pr WHERE pr.inspection_id = i.id
     AND pr.finding IN ('not_complied','partially_complied')) AS previous_outstanding,
  prev.ref_no AS previous_ref_no,
  prev.started_at AS previous_started_at
FROM inspections i
JOIN modules m ON m.id = i.module_id
JOIN inspection_types it ON it.id = i.inspection_type_id
JOIN users u ON u.id = i.inspector_id
LEFT JOIN stations s ON s.id = i.station_id
LEFT JOIN divisions d ON d.id = s.division_id
LEFT JOIN trains t ON t.id = i.train_id
LEFT JOIN inspections prev ON prev.id = i.previous_inspection_id;
