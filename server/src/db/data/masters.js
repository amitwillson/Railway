/**
 * Departments, unit templates, the rule engine and application settings.
 *
 * The organisation and station masters are not here: they come from the
 * division's own records and live in `data/bilaspur.js`. What is left in this
 * file is the part that is the same everywhere - the department list, the areas a
 * station or a train is made of, severities, TDC and notification rules. All of
 * it is editable from the Admin Panel.
 */

export const departments = [
  { code: 'COM', name: 'Commercial', sort_order: 10 },
  { code: 'OPS', name: 'Operating', sort_order: 20 },
  { code: 'ENGG', name: 'Engineering', sort_order: 30 },
  { code: 'ELEC', name: 'Electrical', sort_order: 40 },
  { code: 'SNT', name: 'S&T', sort_order: 50 },
  { code: 'MECH', name: 'Mechanical', sort_order: 60 },
  { code: 'RPF', name: 'RPF', sort_order: 70 },
  { code: 'GRP', name: 'GRP/Police', sort_order: 80 },
  { code: 'MED', name: 'Medical', sort_order: 90 },
  { code: 'PERS', name: 'Personnel', sort_order: 100 },
  { code: 'ACC', name: 'Accounts', sort_order: 110 },
  { code: 'STR', name: 'Stores', sort_order: 120 },
  { code: 'SAF', name: 'Safety', sort_order: 130 },
  { code: 'IT', name: 'IT', sort_order: 140 },
  { code: 'STN', name: 'Station Management', sort_order: 150 },
  { code: 'CONT', name: 'Contractor', sort_order: 160, is_external: 1 },
  { code: 'LIC', name: 'Licensee', sort_order: 170, is_external: 1 },
  { code: 'VEN', name: 'Vendor', sort_order: 180, is_external: 1 },
  { code: 'OTH', name: 'Other', sort_order: 999 },
];

/**
 * Station master.
 *
 * The Jabalpur division of West Central Railway, grouped by section, plus the
 * adjoining junctions an inspecting officer of this division actually books
 * inspections at. Station names and the sections they sit on are the useful part;
 * the codes, NSG categories and platform counts are indicative and should be
 * checked against the divisional list before the system is used in earnest.
 *
 * Nothing here needs a code change to correct: the Admin Panel edits stations one
 * at a time, and Admin -> Stations -> Import replaces the whole list from a CSV.
 */
/**
 * Trains.
 *
 * PAMS and the divisional dashboard carry stations, not trains, so this list is
 * NOT from the division's records: it is the few services this division is known
 * to originate or handle, enough for a train inspection to be recorded and
 * demonstrated. It needs replacing with the divisional train list before Module C
 * is used in earnest - the Admin Panel edits it, and nothing in the application
 * depends on these particular numbers.
 */
export const trains = [
  { number: '18237', name: 'Chhattisgarh Express', origin_code: 'BSP', origin: 'Bilaspur', destination_code: 'ASR', destination: 'Amritsar', train_type: 'Express', has_pantry: 1 },
  { number: '18238', name: 'Chhattisgarh Express', origin_code: 'ASR', origin: 'Amritsar', destination_code: 'BSP', destination: 'Bilaspur', train_type: 'Express', has_pantry: 1 },
  { number: '12409', name: 'Gondwana Express', origin_code: 'RIG', origin: 'Raigarh', destination_code: 'NZM', destination: 'Hazrat Nizamuddin', train_type: 'Superfast', has_pantry: 1 },
  { number: '12410', name: 'Gondwana Express', origin_code: 'NZM', origin: 'Hazrat Nizamuddin', destination_code: 'RIG', destination: 'Raigarh', train_type: 'Superfast', has_pantry: 1 },
];

/** Station areas offered for every station (templates). */
export const stationUnits = [
  { name: 'Platform No. 1', kind: 'platform', sort_order: 10 },
  { name: 'Platform No. 2', kind: 'platform', sort_order: 20 },
  { name: 'Platform No. 3', kind: 'platform', sort_order: 30 },
  { name: 'Platform No. 4', kind: 'platform', sort_order: 40 },
  { name: 'Platform No. 5', kind: 'platform', sort_order: 50 },
  { name: 'Platform No. 6', kind: 'platform', sort_order: 60 },
  { name: 'Platform No. 7', kind: 'platform', sort_order: 62 },
  { name: 'Platform No. 8', kind: 'platform', sort_order: 64 },
  { name: 'Booking Hall', kind: 'booking office', sort_order: 70 },
  { name: 'Reservation Hall', kind: 'reservation office', sort_order: 80 },
  { name: 'Concourse', kind: 'concourse', sort_order: 90 },
  { name: 'Waiting Hall', kind: 'waiting hall', sort_order: 100 },
  { name: 'Circulating Area', kind: 'circulating area', sort_order: 110 },
  { name: 'FOB', kind: 'fob', sort_order: 120 },
  { name: 'Subway', kind: 'subway', sort_order: 130 },
  { name: 'Station Entrance', kind: 'entrance', sort_order: 140 },
  { name: 'Station Exit', kind: 'exit', sort_order: 150 },
  { name: 'Parcel Office', kind: 'parcel office', sort_order: 160 },
  { name: 'Catering Area', kind: 'catering', sort_order: 170 },
  { name: 'Parking Area', kind: 'parking', sort_order: 180 },
  { name: 'Pay & Use Toilet', kind: 'toilet', sort_order: 190 },
  { name: 'Retiring Room', kind: 'retiring room', sort_order: 200 },
  { name: 'Cloak Room', kind: 'cloak room', sort_order: 210 },
  { name: 'Other', kind: 'other', sort_order: 990 },
];

/** Train areas offered for every train inspection. */
export const trainUnits = [
  { name: 'Coach', kind: 'coach', sort_order: 10 },
  { name: 'Pantry Car', kind: 'pantry', sort_order: 20 },
  { name: 'Reserved Coach', kind: 'coach', sort_order: 30 },
  { name: 'Unreserved Coach', kind: 'coach', sort_order: 40 },
  { name: 'Luggage/Brake Van', kind: 'brake van', sort_order: 50 },
  { name: 'Vestibule', kind: 'vestibule', sort_order: 60 },
  { name: 'Door Area', kind: 'door', sort_order: 70 },
  { name: 'Gangway', kind: 'gangway', sort_order: 80 },
  { name: 'Coach Toilet', kind: 'toilet', sort_order: 90 },
  { name: 'Passenger Compartment', kind: 'compartment', sort_order: 100 },
  { name: 'Other', kind: 'other', sort_order: 990 },
];

/** Extra platforms that only exist at the larger stations. */
/**
 * Areas that exist only at particular stations. Bilaspur and Raigarh are the two
 * stations PAMS records as having a food plaza and retiring rooms, so those areas
 * are offered there and nowhere else.
 */
export const extraStationUnits = [
  { station: 'BSP', name: 'Food Plaza', kind: 'catering', sort_order: 175 },
  { station: 'BSP', name: 'Divyangjan Facilitation Counter', kind: 'other', sort_order: 220 },
  { station: 'BSP', name: 'Second Entry Circulating Area', kind: 'circulating area', sort_order: 115 },
  { station: 'RIG', name: 'Food Plaza', kind: 'catering', sort_order: 175 },
  { station: 'RIG', name: 'Second Entry Circulating Area', kind: 'circulating area', sort_order: 115 },
];

export const modules = [
  {
    code: 'PA',
    name: 'Passenger Amenities',
    tagline: 'Station facilities & passenger services',
    description:
      'Inspection of facilities and services provided to passengers at stations and other passenger interfaces.',
    accent: 'blue',
    sort_order: 10,
  },
  {
    code: 'CI',
    name: 'Commercial Inspection',
    tagline: 'Commercial working, revenue & contracts',
    description:
      'Inspection of commercial activities: revenue, contracts, licences, ticketing, catering, parcel, parking and other commercial matters.',
    accent: 'green',
    sort_order: 20,
  },
  {
    code: 'SR',
    name: 'Safe Running - Commercial',
    tagline: 'Commercial aspects affecting safe train working',
    description:
      'Inspection of commercial-department-related items bearing on safe, orderly and compliant running of passenger trains.',
    accent: 'amber',
    sort_order: 30,
  },
];

export const inspectionTypes = [
  { name: 'Passenger Amenities Inspection', module: 'PA', sort_order: 10 },
  { name: 'Commercial Inspection', module: 'CI', sort_order: 20 },
  { name: 'Safe Running - Commercial Inspection', module: 'SR', sort_order: 30 },
  { name: 'Station Inspection', sort_order: 40 },
  { name: 'Train Inspection', sort_order: 50 },
  { name: 'Section Inspection', sort_order: 60 },
  { name: 'Surprise Inspection', sort_order: 70 },
  { name: 'Routine Inspection', sort_order: 80 },
  { name: 'Special Inspection', sort_order: 90 },
  { name: 'Joint Inspection', sort_order: 100 },
  { name: 'Follow-up Inspection', sort_order: 110 },
  { name: 'Compliance Inspection', sort_order: 120 },
  { name: 'Thematic Inspection', sort_order: 130 },
  { name: 'Other', sort_order: 999 },
];

export const itemParameters = [
  { name: 'Available', polarity: 'positive', sort_order: 10 },
  { name: 'Functional', polarity: 'positive', sort_order: 20 },
  { name: 'Clean', polarity: 'positive', sort_order: 30 },
  { name: 'Adequate', polarity: 'positive', sort_order: 40 },
  { name: 'Accessible', polarity: 'positive', sort_order: 50 },
  { name: 'Properly displayed', polarity: 'positive', sort_order: 60 },
  { name: 'Properly maintained', polarity: 'positive', sort_order: 70 },
  { name: 'Safe for passenger use', polarity: 'positive', sort_order: 80 },
  { name: 'Requires repair', polarity: 'negative', sort_order: 90 },
  { name: 'Requires replacement', polarity: 'negative', sort_order: 100 },
  { name: 'Not available', polarity: 'negative', sort_order: 110 },
  { name: 'Not functional', polarity: 'negative', sort_order: 120 },
  { name: 'Not applicable', polarity: 'neutral', sort_order: 130 },
];

export const observationCategories = [
  'Passenger Amenity',
  'Passenger Service',
  'Commercial',
  'Revenue',
  'Ticketing',
  'Catering',
  'Parcel',
  'Contract',
  'Licensing',
  'Train Working',
  'Passenger Movement',
  'Safe Running - Commercial',
  'Cleanliness',
  'Passenger Information',
  'Other',
];

export const severities = [
  {
    name: 'Critical',
    rank: 1,
    definition:
      'Affects passenger safety, safe running of trains or causes serious revenue loss. Requires immediate action and immediate notification to management.',
    default_tdc_days: 1,
    notify_immediately: 1,
    escalate_immediately: 1,
    accent: 'red',
  },
  {
    name: 'Major',
    rank: 2,
    definition:
      'Significant deficiency in a passenger amenity, commercial working or revenue accountal that needs early rectification.',
    default_tdc_days: 7,
    notify_immediately: 0,
    escalate_immediately: 0,
    accent: 'orange',
  },
  {
    name: 'Moderate',
    rank: 3,
    definition: 'Deficiency to be rectified in the normal course of maintenance or working.',
    default_tdc_days: 15,
    notify_immediately: 0,
    escalate_immediately: 0,
    accent: 'amber',
  },
  {
    name: 'Minor',
    rank: 4,
    definition: 'Minor shortcoming, cosmetic or procedural, to be attended to during routine upkeep.',
    default_tdc_days: 30,
    notify_immediately: 0,
    escalate_immediately: 0,
    accent: 'slate',
  },
];

export const tdcRules = [
  {
    name: 'Default TDC monitoring',
    severity: null,
    remind_before_days: 2,
    remind_on_due_date: 1,
    overdue_repeat_days: 3,
    escalate_after_days: 7,
    escalate_to_role: 'divisional_officer',
  },
  {
    name: 'Critical observations',
    severity: 'Critical',
    remind_before_days: 1,
    remind_on_due_date: 1,
    overdue_repeat_days: 1,
    escalate_after_days: 1,
    escalate_to_role: 'divisional_officer',
  },
  {
    name: 'Major observations',
    severity: 'Major',
    remind_before_days: 2,
    remind_on_due_date: 1,
    overdue_repeat_days: 2,
    escalate_after_days: 3,
    escalate_to_role: 'divisional_officer',
  },
  {
    name: 'Minor observations',
    severity: 'Minor',
    remind_before_days: 3,
    remind_on_due_date: 1,
    overdue_repeat_days: 7,
    escalate_after_days: 15,
    escalate_to_role: 'divisional_officer',
  },
];

export const escalationLevels = [
  { level: 1, name: 'Reporting officer', after_days: 3, target_role: 'supervisor', target_designation: 'Reporting officer of the concerned supervisor', notes: 'First escalation when compliance is not received after the TDC.' },
  { level: 2, name: 'Divisional officer', after_days: 7, target_role: 'divisional_officer', target_designation: 'Sr. DCM / DCM', notes: 'Second escalation to divisional level.' },
  { level: 3, name: 'Divisional head', after_days: 15, target_role: 'admin', target_designation: 'ADRM / DRM', notes: 'Final escalation for persistent non-compliance.' },
];

export const notificationRules = [
  {
    event: 'OBSERVATION_ASSIGNED',
    recipients: ['supervisor'],
    in_app: 1,
    email: 1,
    sms: 0,
    template_title: 'New observation {{ref_no}} assigned to you',
    template_body:
      '{{module_name}} | {{station_or_train}} | {{unit_name}} | {{item_name}}\n' +
      'Observation: {{observation}}\n' +
      'Severity: {{severity_name}} | Action by: {{department_name}} | TDC: {{tdc_text}}\n' +
      'Photographs attached: {{photo_count}}\n' +
      'Inspecting officer: {{inspector_name}}\n' +
      'Inspection: {{inspection_ref}} ({{inspection_type_name}})',
  },
  {
    event: 'OBSERVATION_UNASSIGNED',
    recipients: ['role:admin', 'role:divisional_officer'],
    in_app: 1,
    email: 1,
    sms: 0,
    template_title: 'Observation {{ref_no}} could not be auto-assigned',
    template_body:
      'No active supervisor is mapped for {{department_name}} at {{station_or_train}} ({{unit_name}}).\n' +
      'Observation: {{observation}}\nPlease nominate the concerned supervisor in the Supervisor Master.',
  },
  {
    event: 'CRITICAL_OBSERVATION',
    recipients: ['role:divisional_officer', 'role:admin', 'reporting_officer'],
    in_app: 1,
    email: 1,
    sms: 1,
    template_title: 'CRITICAL: {{ref_no}} at {{station_or_train}}',
    template_body:
      'A critical observation has been recorded and needs immediate attention.\n' +
      '{{unit_name}} | {{item_name}}\nObservation: {{observation}}\n' +
      'Action by: {{department_name}} | Supervisor: {{supervisor_name}} | TDC: {{tdc_text}}\n' +
      'Inspecting officer: {{inspector_name}}',
  },
  {
    event: 'OBSERVATION_ACKNOWLEDGED',
    recipients: ['inspector'],
    in_app: 1,
    email: 0,
    sms: 0,
    template_title: '{{ref_no}} acknowledged by {{supervisor_name}}',
    template_body: '{{item_name}} at {{unit_name}}, {{station_or_train}} has been acknowledged. TDC: {{tdc_text}}',
  },
  {
    event: 'COMPLIANCE_SUBMITTED',
    recipients: ['inspector'],
    in_app: 1,
    email: 1,
    sms: 0,
    template_title: 'Compliance submitted for {{ref_no}}',
    template_body:
      '{{supervisor_name}} has submitted compliance for {{item_name}} at {{unit_name}}, {{station_or_train}}.\n' +
      'Action taken: {{action_taken}}\nPlease verify and close the observation.',
  },
  {
    event: 'COMPLIANCE_REJECTED',
    recipients: ['supervisor', 'reporting_officer'],
    in_app: 1,
    email: 1,
    sms: 0,
    template_title: 'Compliance rejected for {{ref_no}}',
    template_body:
      'The compliance submitted for {{item_name}} at {{unit_name}}, {{station_or_train}} has been rejected.\n' +
      'Reason: {{rejection_reason}}\nThe observation has been reopened. TDC: {{tdc_text}}',
  },
  {
    event: 'PHYSICAL_VERIFICATION_REQUIRED',
    recipients: ['supervisor'],
    in_app: 1,
    email: 1,
    sms: 0,
    template_title: 'Physical verification required for {{ref_no}}',
    template_body:
      'The inspecting officer will physically verify {{item_name}} at {{unit_name}}, {{station_or_train}} before closure.\n' +
      'Remarks: {{verification_remarks}}',
  },
  {
    event: 'OBSERVATION_CLOSED',
    recipients: ['supervisor', 'reporting_officer'],
    in_app: 1,
    email: 0,
    sms: 0,
    template_title: '{{ref_no}} closed',
    template_body:
      'Compliance for {{item_name}} at {{unit_name}}, {{station_or_train}} has been verified and the observation is closed.',
  },
  {
    event: 'OBSERVATION_REOPENED',
    recipients: ['supervisor', 'reporting_officer'],
    in_app: 1,
    email: 1,
    sms: 0,
    template_title: '{{ref_no}} reopened',
    template_body: 'Reason: {{reason}}\n{{item_name}} at {{unit_name}}, {{station_or_train}} needs attention again.',
  },
  {
    event: 'TDC_REMINDER',
    recipients: ['supervisor'],
    in_app: 1,
    email: 1,
    sms: 0,
    template_title: 'Reminder: {{ref_no}} is due in {{days_remaining}} day(s)',
    template_body:
      '{{item_name}} at {{unit_name}}, {{station_or_train}} is due for compliance on {{tdc_text}}.\n' +
      'Observation: {{observation}}',
  },
  {
    event: 'TDC_DUE_TODAY',
    recipients: ['supervisor'],
    in_app: 1,
    email: 1,
    sms: 0,
    template_title: 'Due today: {{ref_no}}',
    template_body:
      'The target date of compliance for {{item_name}} at {{unit_name}}, {{station_or_train}} is today.\n' +
      'Observation: {{observation}}',
  },
  {
    event: 'OBSERVATION_OVERDUE',
    recipients: ['supervisor', 'inspector'],
    in_app: 1,
    email: 1,
    sms: 0,
    template_title: 'OVERDUE by {{overdue_days}} day(s): {{ref_no}}',
    template_body:
      '{{item_name}} at {{unit_name}}, {{station_or_train}} has crossed its TDC of {{tdc_text}}.\n' +
      'Observation: {{observation}}\nPlease submit compliance without further delay.',
  },
  {
    event: 'OBSERVATION_ESCALATED',
    recipients: ['role:divisional_officer'],
    in_app: 1,
    email: 1,
    sms: 0,
    template_title: 'Escalation ({{escalation_name}}): {{ref_no}} overdue by {{overdue_days}} day(s)',
    template_body:
      '{{item_name}} at {{unit_name}}, {{station_or_train}} is pending with {{department_name}} ' +
      '(supervisor: {{supervisor_name}}) beyond its TDC of {{tdc_text}}.\nObservation: {{observation}}',
  },
  {
    event: 'TDC_CHANGED',
    recipients: ['supervisor'],
    in_app: 1,
    email: 0,
    sms: 0,
    template_title: 'TDC revised for {{ref_no}}',
    template_body: 'The target date of compliance has been changed from {{old_tdc}} to {{new_tdc}}.',
  },
  {
    event: 'INSPECTION_COMPLETED',
    recipients: ['role:divisional_officer'],
    in_app: 1,
    email: 0,
    sms: 0,
    template_title: 'Inspection {{inspection_ref}} completed',
    template_body:
      '{{module_name}} inspection of {{station_or_train}} by {{inspector_name}} is complete with ' +
      '{{observation_count}} observation(s).',
  },
  {
    event: 'OTP_LOGIN',
    recipients: [],
    in_app: 0,
    email: 1,
    sms: 1,
    template_title: 'Your login OTP',
    template_body: 'Your one-time password for the Railway Inspection system is {{otp}}. It is valid for a few minutes. Do not share it.',
  },
];

export const settings = [
  { key: 'app.name', value: 'Railway Inspection & Compliance Management System', category: 'general', label: 'Application name' },
  { key: 'app.organisation', value: 'South East Central Railway - Commercial Department', category: 'general', label: 'Organisation' },
  { key: 'app.division_default', value: 'BSP', category: 'general', label: 'Default division code' },
  { key: 'workflow.tdc_mandatory', value: 'false', value_type: 'boolean', category: 'workflow', label: 'Make TDC mandatory on every observation' },
  { key: 'workflow.repeat_window_days', value: '90', value_type: 'number', category: 'workflow', label: 'Repeated deficiency look-back window (days)' },
  { key: 'workflow.allow_supervisor_self_close', value: 'false', value_type: 'boolean', category: 'workflow', label: 'Allow a supervisor to close an observation without inspector verification' },
  { key: 'workflow.physical_verification_default', value: 'false', value_type: 'boolean', category: 'workflow', label: 'Default "physical verification required" on critical observations' },
  { key: 'notification.digest_hour', value: '7', value_type: 'number', category: 'notification', label: 'Hour of the daily pending digest' },
  { key: 'report.footer', value: 'Generated by the Railway Inspection & Compliance Management System', category: 'report', label: 'Report footer' },

  /* Inspection Note - the letter format. Changing these changes every note
     printed afterwards; notes already issued keep the wording they carry. */
  { key: 'note.letterhead', value: 'SOUTH EAST CENTRAL RAILWAY\nOffice of the Divisional Railway Manager (Commercial)\nBilaspur Division', category: 'note', label: 'Letterhead block (one line per row)' },
  { key: 'note.office', value: 'Sr. Divisional Commercial Manager, Bilaspur', category: 'note', label: 'Issuing office (printed under the signature)' },
  { key: 'note.number_prefix', value: 'BSP/COM/INSP', category: 'note', label: 'Inspection note number prefix' },
  { key: 'note.addressee', value: 'The Concerned Supervisors / Departmental Officers', category: 'note', label: 'Default addressee' },
  { key: 'note.salutation', value: 'Sir / Madam,', category: 'note', label: 'Salutation' },
  { key: 'note.preamble', value: 'The following deficiencies were noticed during the inspection referred to above. The concerned officials are requested to take necessary action and advise compliance to this office within the target date indicated against each item.', category: 'note', label: 'Opening paragraph' },
  { key: 'note.closing', value: 'Compliance may please be advised through the inspection management system, with photographic evidence where applicable.', category: 'note', label: 'Closing paragraph' },
  { key: 'note.copy_to', value: 'Sr. DCM / DCM / concerned Branch Officers - for information and necessary action.', category: 'note', label: 'Copy to' },
];

export const ruleReferences = [
  { code: 'RB-CML-2023-01', title: 'Provision and maintenance of minimum essential amenities at stations', authority: 'Railway Board', reference_no: '2023/TG-IV/10/1', issued_on: '2023-04-12' },
  { code: 'RB-CTG-2022-07', title: 'Catering policy - licence conditions, rate list and menu display', authority: 'Railway Board', reference_no: '2022/TG-III/600/2', issued_on: '2022-07-19' },
  { code: 'IRCA-CM-16', title: 'Commercial Manual Vol. I - Chapter XVI: Passenger amenities', authority: 'IRCA', reference_no: 'CM-I/XVI' },
  { code: 'IRCA-CM-22', title: 'Commercial Manual Vol. II - Parcel and luggage working', authority: 'IRCA', reference_no: 'CM-II/XXII' },
  { code: 'RB-SAF-2021-03', title: 'Crowd management and passenger movement at stations', authority: 'Railway Board', reference_no: '2021/Safety/Crowd/1', issued_on: '2021-11-05' },
  { code: 'SECR-CML-2024-11', title: 'Divisional instructions on unauthorised vending and platform obstruction', authority: 'South East Central Railway', reference_no: 'SECR/COM/UV/2024', issued_on: '2024-02-28' },
  { code: 'RB-DIV-2022-04', title: 'Facilities for Divyangjan passengers at stations and in trains', authority: 'Railway Board', reference_no: '2022/TG-I/20/11', issued_on: '2022-09-30' },
  { code: 'RB-CLN-2023-09', title: 'Cleanliness and sanitation standards at railway stations', authority: 'Railway Board', reference_no: '2023/Env/Clean/3', issued_on: '2023-08-08' },
];
