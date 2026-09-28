export type Role = 'admin' | 'divisional_officer' | 'inspector' | 'supervisor' | 'viewer';

export type ObservationStatus =
  | 'submitted' | 'assigned' | 'acknowledged' | 'in_progress'
  | 'compliance_submitted' | 'verified' | 'closed'
  | 'rejected' | 'reopened' | 'cancelled';

export interface User {
  id: number;
  employee_id: string;
  name: string;
  designation: string | null;
  role: Role;
  email: string | null;
  mobile: string | null;
  department_id: number | null;
  department_name?: string | null;
  division_id: number | null;
  division_name?: string | null;
  station_id: number | null;
  station_name?: string | null;
  supervisor_id: number | null;
  active: boolean;
  must_change_password: boolean;
}

export interface Module {
  id: number;
  code: 'PA' | 'CI' | 'SR' | string;
  name: string;
  tagline: string | null;
  description: string | null;
  accent: 'blue' | 'green' | 'amber' | string | null;
  sort_order: number;
}

export interface Named { id: number; name: string }
export interface Department extends Named { code: string; is_external?: number }
export interface Severity extends Named {
  rank: number; definition: string | null; default_tdc_days: number | null;
  notify_immediately: number; escalate_immediately: number; accent: string | null;
}
export interface InspectionType extends Named { module_id: number | null; module_code?: string | null }
export interface ItemParameter extends Named { polarity: 'positive' | 'negative' | 'neutral' }
export interface ItemGroup extends Named { module_id: number; module_code?: string }

export interface Station {
  id: number; code: string; name: string;
  division_id: number; division_name?: string; division_code?: string;
  zone_name?: string; zone_code?: string;
  category: string | null; station_type: string | null; platforms: number;
  section?: string | null; section_name?: string | null;
  state?: string | null; district?: string | null; route?: string | null; km?: number | null;
  latitude?: number | null; longitude?: number | null;
}

export interface Section {
  id: number; code: string; name: string;
  division_code?: string | null; station_count?: number; sort_order: number;
}

/**
 * What a station actually has, from the division's PAMS record. It is a periodic
 * extract, not something this system maintains, so it carries the date it was
 * last updated there.
 */
export interface StationFacilities {
  station_id: number;
  passengers_per_day: number; max_passengers_at_a_time: number;
  trains_mail_express: number; trains_passenger: number;
  booking_windows: number; uts_counters: number; prs_counter: number; enquiry_counters: number;
  atm_count: number; food_plaza: number; refreshment_room: number; base_kitchen: number;
  cloak_room: number; parcel_facility: number;
  ac_retiring_rooms: number; non_ac_retiring_rooms: number;
  waiting_hall_area_sqm: number; waiting_hall_seats: number;
  foot_over_bridges: number; subways: number; second_entry: number;
  pa_system: number; train_indication_board: number; station_clock: number;
  rpf_post: number; grp_post: number;
  water_source: string | null; water_supply_type: string | null;
  wheelchair: number; divyangjan_toilet: number; divyangjan_ramp: number;
  divyangjan_water_tap: number; escalator_or_lift: number; braille_signage: number;
  aen_unit: string | null; iow_unit: string | null;
  remarks: string | null; pams_updated_on: string | null; pams_updated_by: string | null;
}

/** Minimum Essential Amenities: provided against required, at one station. */
export interface AmenityNorm {
  id: number; station_id: number;
  item_id: number | null; item_label: string; item_name?: string | null;
  unit: 'nos' | 'sqm' | 'yes/no' | string;
  provided: number; required: number;
  shortfall: number; meets_norm: boolean;
  source: string | null;
}

export interface Train {
  id: number; number: string; name: string;
  origin: string | null; destination: string | null;
  train_type: string | null; has_pantry: number;
  inspections?: number; observations?: number; pending?: number; last_inspected_at?: string | null;
}

export interface Unit {
  id: number; name: string; applies_to: 'station' | 'train' | 'both';
  station_id: number | null; kind: string | null; sort_order: number;
  station_specific?: boolean;
}

export interface InspectionItem {
  id: number; group_id: number; module_id: number; name: string;
  applies_to: 'station' | 'train' | 'both';
  group_name?: string; module_code?: string;
  default_department_id: number | null;
  default_department_name?: string | null;
  default_category_id: number | null;
  default_severity_id: number | null;
  rule_reference_id: number | null;
  rule_code?: string; rule_title?: string;
  parameters?: ItemParameter[];
}

/** A station a supervisor answers for. The primary posting is one of these. */
export interface SupervisorStationLink {
  /** Present when the link was read on its own; absent inside a ranked candidate. */
  id?: number;
  station_id: number; station_name: string; station_code: string;
  is_primary: boolean; section?: string | null; priority?: number; active?: boolean;
}

export interface SupervisorDepartmentLink {
  id?: number;
  department_id: number; department_name: string; department_code: string;
  is_primary: boolean; priority?: number; active?: boolean;
}

export interface Supervisor {
  id: number; employee_id: string; name: string; designation: string | null;
  department_id: number; department_name?: string; sub_department: string | null;
  station_id: number | null; station_name?: string | null; section?: string | null;
  area_of_responsibility: string | null; mobile: string | null; email: string | null;
  reporting_officer_name?: string | null;
  /** Every station and department this supervisor is linked to, primary first. */
  stations?: SupervisorStationLink[];
  departments?: SupervisorDepartmentLink[];
  station_count?: number; department_count?: number;
  match_reason?: string; match_score?: number; active?: boolean;
}

/** One entry of the "what usually fails" dropdown under the observation box. */
export interface Deficiency {
  id: number;
  text: string;
  template: string;
  scope: 'item' | 'group' | 'module' | 'generic';
  department_id: number | null; department_name: string | null; department_code: string | null;
  severity_id: number | null; severity_name: string | null;
  category_id: number | null; category_name: string | null;
  suggested_tdc_days: number | null;
  times_used: number;
}

export interface DeficiencyList {
  item: { id: number; name: string; group_id: number; module_id: number };
  data: Deficiency[];
  previously_used: { text: string; times_used: number; last_used: string }[];
}

export interface RuleReference {
  id: number; code: string; title: string; authority: string | null;
  reference_no: string | null; url: string | null;
}

export interface Bootstrap {
  generated_at: string;
  modules: Module[];
  inspection_types: InspectionType[];
  location_types: string[];
  departments: Department[];
  observation_categories: Named[];
  severities: Severity[];
  item_parameters: ItemParameter[];
  item_groups: ItemGroup[];
  divisions: (Named & { code: string; zone_code: string })[];
  zones: (Named & { code: string })[];
  rule_references: RuleReference[];
  settings: Record<string, string>;
  counts: { stations: number; trains: number; items: number; supervisors: number };
}

export interface Inspection {
  id: number; ref_no: string; module_id: number; module_code: string; module_name: string;
  module_accent: string | null;
  inspection_type_id: number; inspection_type_name: string;
  location_type: string; section: string | null; title: string | null;
  station_id: number | null; station_name: string | null; station_code: string | null;
  station_category?: string | null; division_name?: string | null;
  train_id: number | null; train_number: string | null; train_name: string | null;
  inspector_id: number; inspector_name: string; inspector_designation: string | null;
  joint_with: string | null;
  planned_date: string | null; started_at: string | null; completed_at: string | null;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  summary: string | null; auto_summary: string | null; notes: string | null;
  qr_token: string | null; created_at: string;
  observation_count: number; open_count: number; closed_count: number; critical_count: number;
}

export interface ObservationParameter { parameter_id?: number | null; name: string; value?: boolean | string }

export interface Observation {
  id: number; ref_no: string;
  inspection_id: number; inspection_ref: string; inspection_type_name: string;
  module_id: number; module_code: string; module_name: string; module_accent: string | null;
  station_id: number | null; station_name: string | null; station_code: string | null;
  division_name?: string | null;
  train_id: number | null; train_number: string | null; train_name: string | null;
  coach: string | null;
  unit_id: number | null; unit_name: string | null;
  item_id: number | null; item_name: string | null;
  deficiency_id?: number | null;
  parameters: ObservationParameter[];
  observation: string;
  category_id: number | null; category_name: string | null;
  severity_id: number; severity_name: string; severity_rank: number;
  action_by_department_id: number; department_name: string; department_code: string;
  supervisor_id: number | null; supervisor_name: string | null;
  supervisor_designation: string | null; supervisor_mobile: string | null;
  assignment_mode: 'auto' | 'manual' | 'unassigned';
  rule_reference_id: number | null;
  tdc: string | null; days_to_tdc: number | null;
  status: ObservationStatus;
  requires_physical_verification: boolean;
  repeat_count: number; repeat_of_id: number | null;
  escalation_level: number; reopen_count: number; cancel_reason: string | null;
  created_by: number; inspector_name: string; inspector_designation: string | null;
  observed_at: string; acknowledged_at: string | null;
  compliance_submitted_at: string | null; verified_at: string | null; closed_at: string | null;
  attachment_count: number;
  is_overdue: boolean; is_open: boolean;
  location_label: string;
  client_uuid?: string | null;
}

/** One observation as it appears on an inspection note. */
export interface NoteObservation {
  sl_no: number;
  remarks: string | null;
  id: number; ref_no: string;
  station_id: number | null; station_name: string | null; station_code: string | null;
  train_id: number | null; train_number: string | null; train_name: string | null;
  module_id: number; module_code: string; module_name: string;
  unit_name: string | null; coach: string | null; item_name: string | null;
  observation: string;
  tdc: string | null; days_to_tdc: number | null;
  status: ObservationStatus;
  severity_name: string;
  department_name: string; department_code: string;
  supervisor_name: string | null; supervisor_designation: string | null; supervisor_mobile: string | null;
  observed_at: string;
  is_overdue: boolean; repeat_count: number; attachment_count: number;
  inspection_id: number;
}

/** The letter itself: several observations compiled under one number. */
export interface InspectionNote {
  id: number;
  note_no: string;
  inspection_id: number | null; inspection_ref?: string | null; inspection_type_name?: string | null;
  module_id: number | null; module_code?: string | null; module_name?: string | null;
  station_id: number | null; station_name?: string | null; station_code?: string | null;
  train_id: number | null; train_number?: string | null;
  letter_date: string;
  subject: string;
  addressee: string | null; salutation: string | null;
  preamble: string | null; closing: string | null; copy_to: string | null;
  signatory_name: string | null; signatory_designation: string | null;
  office: string | null; letterhead: string | null;
  status: 'draft' | 'issued' | 'cancelled';
  qr_token: string | null;
  created_by: number; created_by_name: string; created_by_designation?: string | null;
  issued_at: string | null; created_at: string; updated_at: string | null;
  observations: NoteObservation[];
  by_department?: { department: string; code: string | null; observations: NoteObservation[] }[];
}

export interface NoteSummary {
  id: number; note_no: string; subject: string; letter_date: string;
  status: 'draft' | 'issued' | 'cancelled';
  module_code: string | null; station_name: string | null; station_code: string | null;
  train_number: string | null; inspection_ref: string | null;
  created_by_name: string; observation_count: number; closed_count: number;
  issued_at: string | null;
}

/** What the compose screen starts from, before a note exists. */
export interface NoteDraft {
  inspection: Inspection | null;
  observations: NoteObservation[];
  note_no: string;
  letter_date: string;
  subject: string;
  letterhead: string; office: string; number_prefix: string;
  addressee: string; salutation: string; preamble: string; closing: string; copy_to: string;
}

export interface Attachment {
  id: number; observation_id: number | null; compliance_id: number | null;
  kind: 'photo' | 'video' | 'document' | 'signature';
  phase: 'observation' | 'compliance' | 'verification';
  file_name: string; stored_name: string; mime_type: string | null;
  size_bytes: number | null; caption: string | null; created_at: string;
}

export interface Compliance {
  id: number; observation_id: number; round: number;
  action_taken: string; remarks: string | null; compliance_date: string;
  status: 'submitted' | 'accepted' | 'rejected' | 'physical_verification_required';
  submitted_at: string; submitted_by_name: string; submitted_by_designation: string | null;
  verified_by_name: string | null; verified_at: string | null;
  verification_remarks: string | null; rejection_reason: string | null;
  attachments?: Attachment[];
}

export interface TimelineEvent {
  id: number; action: string; from_status: string | null; to_status: string | null;
  actor_name: string; actor_role: string; remarks: string | null;
  metadata: Record<string, unknown> | null; created_at: string;
}

export interface RepeatMatch {
  id: number; ref_no: string; observation: string; unit_name: string | null;
  item_name: string | null; status: string; observed_at: string;
  severity_name: string; match_reason: string; similarity: number; photo_count: number;
  inspection_ref: string; inspector_name: string;
}

export interface RepeatResult {
  count: number; window_days: number; matches: RepeatMatch[];
  message: string | null; item_name?: string | null; unit_name?: string | null;
}

export interface Approval {
  id: number; approval_role: string; user_name: string; designation: string | null;
  remarks: string | null; signature_data: string | null; signed_at: string;
}

export interface ObservationDetail extends Observation {
  timeline: TimelineEvent[];
  attachments: Attachment[];
  compliances: Compliance[];
  repeats: RepeatResult;
  approvals: Approval[];
  rule_reference: RuleReference | null;
  supervisor: Supervisor | null;
  notifications: { id: number; event: string; title: string; created_at: string; recipient: string; channels: string | null }[];
  permissions: {
    can_acknowledge: boolean; can_submit_compliance: boolean; can_verify: boolean;
    can_reassign: boolean; can_edit: boolean; can_cancel: boolean;
  };
}

export interface Paged<T> {
  data: T[]; page: number; page_size: number; total: number; total_pages: number;
}

export interface Notification {
  id: number; event: string; title: string; body: string | null;
  observation_id: number | null; observation_ref?: string | null;
  severity: string | null; link: string | null; read_at: string | null; created_at: string;
  delivery_status?: string | null;
  station_name?: string | null; unit_name?: string | null; item_name?: string | null; tdc?: string | null;
}

export interface Counters {
  my_open: number; assigned_to_me: number; pending: number; compliance_pending: number;
  awaiting_verification: number; overdue: number; critical_open: number;
  closed: number; repeated_open: number;
}

export interface DashboardOverview {
  observations: Record<string, number>;
  inspections: Record<string, number>;
  compliance: {
    avg_closure_days: number | null; fastest_closure_days: number | null;
    slowest_closure_days: number | null; closed_on_time: number; closed_late: number;
    closure_rate: number;
  };
}

export interface ModuleStat extends Record<string, unknown> {
  module: Module; inspections: number; total: number; open: number; overdue: number;
  closed: number; critical: number; critical_open: number; repeated: number;
  compliance_submitted: number;
}

export interface QueuedOperation {
  client_uuid: string;
  type: 'inspection' | 'observation';
  inspection_client_uuid?: string;
  payload: Record<string, unknown>;
  created_at: string;
  label: string;
  photos?: number;
  error?: string;
}
