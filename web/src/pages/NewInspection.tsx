import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { useOffline } from '../state/OfflineContext';
import { useToast } from '../state/ToastContext';
import Icon, { type IconName } from '../components/Icon';
import {
  Badge, Banner, Button, Card, Field, PhotoPicker, SearchSelect, Spinner, type Option,
} from '../components/ui';
import { AreaSheet, CoverageStrip, PreviousReview } from '../components/InspectionSheet';
import { dictate, speechSupported, type Dictation } from '../lib/speech';
import { addDays, formatDate, todayIso } from '../lib/format';
import type {
  AmenityNorm, AreaResult, Deficiency, DeficiencyList, Department, Inspection, InspectionArea,
  InspectionItem, InspectionScope, InspectionSheet, ItemResult, Observation, PreviousFinding,
  PreviousItem, PreviousOutstanding, RepeatResult, Station, Supervisor, Train, Unit,
} from '../api/types';

const DRAFT_KEY = 'ri.activeInspection';

/** The inspection currently being recorded into - it may exist only locally. */
interface ActiveInspection {
  id?: number;
  ref_no?: string;
  client_uuid: string;
}

interface ItemsResponse {
  data: InspectionItem[];
  groups: { group_id: number; group_name: string; items: InspectionItem[] }[];
}

export default function NewInspection() {
  const { masters, refreshCounters, user } = useAuth();
  const { online, enqueue } = useOffline();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  /* ----------------------------- inspection context ---------------------- */
  const [moduleCode, setModuleCode] = useState<string>(params.get('module') ?? 'PA');
  const [typeId, setTypeId] = useState<number | null>(null);
  // An inspection covers a place, never a single area. `scope` says which kind of
  // place; the areas live on the sheet inside it.
  const [scope, setScope] = useState<InspectionScope>('station');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [jointWith, setJointWith] = useState('');
  const [starting, setStarting] = useState(false);
  const [station, setStation] = useState<Station | null>(null);
  const [train, setTrain] = useState<Train | null>(null);
  const [stationOptions, setStationOptions] = useState<Station[]>([]);
  const [trainOptions, setTrainOptions] = useState<Train[]>([]);
  const [inspection, setInspection] = useState<ActiveInspection | null>(null);
  const [recorded, setRecorded] = useState<
    { id?: number; ref_no: string; text: string; unit?: string | null; item?: string | null; supervisor?: string | null; offline?: boolean }[]
  >([]);

  /* ------------------------------- the sheet ----------------------------- */
  const [sheet, setSheet] = useState<InspectionSheet | null>(null);
  const [previous, setPrevious] = useState<PreviousOutstanding | null>(null);
  const [openAreaId, setOpenAreaId] = useState<number | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<number | null>(null);
  /** The observation form is only in the way until there is something to report. */
  const [recording, setRecording] = useState(false);
  const [areaId, setAreaId] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  /* ----------------------------- observation fields ---------------------- */
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [coach, setCoach] = useState('');
  const [items, setItems] = useState<ItemsResponse | null>(null);
  const [itemId, setItemId] = useState<number | null>(null);
  const [itemDetail, setItemDetail] = useState<InspectionItem | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [deficiencies, setDeficiencies] = useState<DeficiencyList | null>(null);
  const [norms, setNorms] = useState<AmenityNorm[]>([]);
  const [deficiencyId, setDeficiencyId] = useState<number | null>(null);
  /** The wording the last picked suggestion put in the box, so an edit is never lost. */
  const suggested = useRef('');
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [supervisorId, setSupervisorId] = useState<number | null>(null);
  const [autoSupervisor, setAutoSupervisor] = useState<Supervisor | null>(null);
  const [resolvingSupervisor, setResolvingSupervisor] = useState(false);
  const [severityId, setSeverityId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [ruleId, setRuleId] = useState<number | null>(null);
  const [hasTdc, setHasTdc] = useState(false);
  const [tdc, setTdc] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [repeats, setRepeats] = useState<RepeatResult | null>(null);
  const [listening, setListening] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dictation = useRef<Dictation | null>(null);
  const baseText = useRef('');

  const isTrain = scope === 'train';
  const locationType = scope === 'train' ? 'Train' : scope === 'section' ? 'Other' : 'Station';
  const modules = masters?.modules ?? [];
  const selectedModule = modules.find((m) => m.code === moduleCode) ?? modules[0];

  /* ------------------------------ master loading ------------------------- */

  useEffect(() => {
    // Restore an inspection that is still in progress on this device.
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft?.client_uuid) {
          setInspection(draft.inspection);
          setModuleCode(draft.moduleCode ?? 'PA');
          setTypeId(draft.typeId ?? null);
          setScope(draft.scope ?? 'station');
          setStation(draft.station ?? null);
          setTrain(draft.train ?? null);
          setRecorded(draft.recorded ?? []);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!inspection) return;
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ client_uuid: inspection.client_uuid, inspection, moduleCode, typeId, scope, station, train, recorded })
      );
    } catch {
      /* ignore */
    }
  }, [inspection, moduleCode, typeId, scope, station, train, recorded]);

  useEffect(() => {
    if (typeId || !masters) return;
    const preferred = masters.inspection_types.find((t) => t.module_code === moduleCode);
    setTypeId(preferred?.id ?? masters.inspection_types[0]?.id ?? null);
  }, [masters, moduleCode, typeId]);

  /* ------------------------------- the sheet ----------------------------- */

  /**
   * Reads the sheet back after every change. It is the record of the visit, so
   * the screen always shows what the server holds rather than a local guess.
   */
  const loadSheet = useCallback(
    async (id: number) => {
      try {
        const next = await api.get<InspectionSheet>(`/inspections/${id}/sheet`);
        setSheet(next);
        return next;
      } catch {
        return null;
      }
    },
    []
  );

  const loadPrevious = useCallback(async (id: number) => {
    try {
      setPrevious(await api.get<PreviousOutstanding>(`/inspections/${id}/previous`));
    } catch {
      setPrevious(null);
    }
  }, []);

  useEffect(() => {
    if (!inspection?.id || !online) return;
    void loadSheet(inspection.id);
    void loadPrevious(inspection.id);
  }, [inspection?.id, online, loadSheet, loadPrevious]);

  const searchStations = useCallback((term: string) => {
    api.get<{ data: Station[] }>('/masters/stations', { q: term || undefined, limit: 40 })
      .then((r) => setStationOptions(r.data))
      .catch(() => {});
  }, []);

  const searchTrains = useCallback((term: string) => {
    api.get<{ data: Train[] }>('/masters/trains', { q: term || undefined, limit: 40 })
      .then((r) => setTrainOptions(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    searchStations('');
    searchTrains('');
  }, [searchStations, searchTrains]);

  // Units follow the station / train selection.
  useEffect(() => {
    if (!station && !isTrain) {
      setUnits([]);
      return;
    }
    api.get<{ data: Unit[] }>('/masters/units', {
      station_id: station?.id, location_type: locationType, applies_to: isTrain ? 'train' : 'station',
    })
      .then((r) => setUnits(r.data))
      .catch(() => setUnits([]));
  }, [station, locationType, isTrain]);

  // Inspection items follow the module and whether this is a station or a train.
  useEffect(() => {
    api.get<ItemsResponse>('/masters/items', {
      module_code: moduleCode, applies_to: isTrain ? 'train' : 'station', limit: 500,
    })
      .then(setItems)
      .catch(() => setItems(null));
  }, [moduleCode, isTrain]);

  // The Minimum Essential Amenities norm for this item at this station: what is
  // provided against what is required. Shown while the observation is written, so
  // the officer has the norm in front of them rather than looking it up after.
  useEffect(() => {
    if (!itemId || !station) {
      setNorms([]);
      return;
    }
    api.get<{ data: AmenityNorm[] }>(`/masters/stations/${station.id}/norms`, { item_id: itemId })
      .then((r) => setNorms(r.data))
      .catch(() => setNorms([]));
  }, [itemId, station]);

  // The suggested-deficiency list follows the item: what usually fails here, and
  // the wordings already used for it at this station.
  useEffect(() => {
    if (!itemId) {
      setDeficiencies(null);
      setDeficiencyId(null);
      return;
    }
    api.get<DeficiencyList>(`/masters/items/${itemId}/deficiencies`, { station_id: station?.id })
      .then(setDeficiencies)
      .catch(() => setDeficiencies(null));
  }, [itemId, station?.id]);

  // Selecting an item pre-fills department, severity, category and rule link.
  useEffect(() => {
    if (!itemId) {
      setItemDetail(null);
      return;
    }
    api.get<InspectionItem>(`/masters/items/${itemId}`)
      .then((detail) => {
        setItemDetail(detail);
        setChecked([]);
        if (detail.default_department_id) setDepartmentId(detail.default_department_id);
        if (detail.default_severity_id) setSeverityId(detail.default_severity_id);
        if (detail.default_category_id) setCategoryId(detail.default_category_id);
        setRuleId(detail.rule_reference_id ?? null);
      })
      .catch(() => {});
  }, [itemId]);

  // Smart assignment: station + unit + department (+ item) -> supervisor.
  useEffect(() => {
    if (!departmentId) {
      setSupervisors([]);
      setAutoSupervisor(null);
      setSupervisorId(null);
      return;
    }
    setResolvingSupervisor(true);
    api.get<{ data: Supervisor[]; auto_selected: Supervisor | null }>('/masters/supervisors/resolve', {
      station_id: station?.id, unit_id: unitId ?? undefined, department_id: departmentId, item_id: itemId ?? undefined,
    })
      .then((r) => {
        setSupervisors(r.data);
        setAutoSupervisor(r.auto_selected);
        setSupervisorId(r.auto_selected?.id ?? null);
      })
      .catch(() => {})
      .finally(() => setResolvingSupervisor(false));
  }, [departmentId, station?.id, unitId, itemId]);

  // Repeated deficiency check as soon as there is enough context.
  useEffect(() => {
    if (!itemId || (!station && !train)) {
      setRepeats(null);
      return;
    }
    const handle = window.setTimeout(() => {
      api.get<RepeatResult>('/observations/repeat-check', {
        station_id: station?.id, train_id: train?.id, unit_id: unitId ?? undefined,
        item_id: itemId, observation: text || undefined, window_days: 90,
      })
        .then(setRepeats)
        .catch(() => setRepeats(null));
    }, 350);
    return () => window.clearTimeout(handle);
  }, [itemId, unitId, station, train, text]);

  // Suggest a TDC from the severity master when the officer switches it on.
  const severity = masters?.severities.find((s) => s.id === severityId);
  useEffect(() => {
    if (hasTdc && !tdc) {
      setTdc(severity?.default_tdc_days ? addDays(todayIso(), severity.default_tdc_days) : addDays(todayIso(), 7));
    }
  }, [hasTdc, tdc, severity]);

  /* --------------------------------- options ---------------------------- */

  const typeOptions: Option[] = useMemo(
    () =>
      (masters?.inspection_types ?? [])
        .filter((t) => !t.module_code || t.module_code === moduleCode)
        .map((t) => ({ value: t.id, label: t.name, sub: t.module_code ? undefined : 'Any module' })),
    [masters, moduleCode]
  );

  const stationOpts: Option[] = useMemo(
    () =>
      stationOptions.map((s) => ({
        value: s.id,
        label: `${s.name} (${s.code})`,
        sub: [s.division_name && `${s.division_name} Div`, s.category, s.station_type].filter(Boolean).join(' · '),
        keywords: s.code,
      })),
    [stationOptions]
  );

  const trainOpts: Option[] = useMemo(
    () =>
      trainOptions.map((t) => ({
        value: t.id,
        label: `${t.number} - ${t.name}`,
        sub: [t.origin, t.destination].filter(Boolean).join(' → '),
        keywords: t.number,
      })),
    [trainOptions]
  );

  const unitOpts: Option[] = useMemo(
    () => units.map((u) => ({ value: u.id, label: u.name, sub: u.station_specific ? 'Specific to this station' : undefined })),
    [units]
  );

  const itemOpts: Option[] = useMemo(
    () =>
      (items?.data ?? []).map((i) => ({
        value: i.id,
        label: i.name,
        group: i.group_name,
        sub: i.default_department_name ? `Usually ${i.default_department_name}` : undefined,
      })),
    [items]
  );

  /**
   * "What usually fails here", narrowest scope first, with the wordings already
   * used for this item at this station offered under their own heading.
   */
  const deficiencyOpts: Option[] = useMemo(() => {
    if (!deficiencies) return [];
    const heading: Record<Deficiency['scope'], string> = {
      item: `Common for ${deficiencies.item.name}`,
      group: 'Common for this category',
      module: 'Common for this module',
      generic: 'General',
    };
    const suggestions = deficiencies.data.map((d) => ({
      value: d.id,
      label: d.text,
      group: heading[d.scope],
      sub: [
        d.department_name && `Action by ${d.department_name}`,
        d.suggested_tdc_days && `TDC ${d.suggested_tdc_days} day${d.suggested_tdc_days === 1 ? '' : 's'}`,
        d.times_used > 0 && `reported ${d.times_used}x`,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    }));
    const used = deficiencies.previously_used.map((p, index) => ({
      value: `used-${index}`,
      label: p.text,
      group: 'Recorded here before',
      sub: `${p.times_used} times · last ${formatDate(p.last_used)}`,
    }));
    return [...suggestions, ...used];
  }, [deficiencies]);

  const departmentOpts: Option[] = useMemo(
    () => (masters?.departments ?? []).map((d: Department) => ({ value: d.id, label: d.name, sub: d.code })),
    [masters]
  );

  const supervisorOpts: Option[] = useMemo(
    () =>
      supervisors.map((s) => ({
        value: s.id,
        label: s.name,
        sub: [s.designation, s.station_name, s.mobile].filter(Boolean).join(' · '),
        keywords: s.employee_id,
      })),
    [supervisors]
  );

  /* -------------------------------- actions ----------------------------- */

  const toggleVoice = () => {
    if (listening) {
      dictation.current?.stop();
      setListening(false);
      return;
    }
    baseText.current = text ? `${text.trim()} ` : '';
    const handle = dictate(
      (transcript) => setText(baseText.current + transcript),
      (err) => {
        setListening(false);
        if (err && err !== 'aborted' && err !== 'no-speech') toast.warn(`Voice input stopped: ${err}`);
      }
    );
    if (!handle) {
      toast.warn('Voice input is not available in this browser');
      return;
    }
    dictation.current = handle;
    setListening(true);
  };

  /**
   * Picking a suggestion fills the observation box and, when the suggestion says
   * so, the department, the severity and the TDC. The wording stays editable: if
   * the inspector has already typed something of their own it is kept and the
   * suggestion is added to it rather than overwriting the work.
   */
  const pickDeficiency = (value: number | string | null) => {
    if (value == null) {
      setDeficiencyId(null);
      return;
    }
    const used = typeof value === 'string' && value.startsWith('used-')
      ? deficiencies?.previously_used[Number(value.slice(5))]
      : null;
    const suggestion = used ? null : deficiencies?.data.find((d) => d.id === value) ?? null;
    const wording = used?.text ?? suggestion?.text;
    if (!wording) return;

    const own = text.trim() && text.trim() !== suggested.current.trim();
    const next = own ? `${text.trim().replace(/[.\s]*$/, '')}. ${wording}` : wording;
    suggested.current = next;
    setText(next);
    setDeficiencyId(suggestion?.id ?? null);

    if (suggestion?.department_id) setDepartmentId(suggestion.department_id);
    if (suggestion?.severity_id) setSeverityId(suggestion.severity_id);
    if (suggestion?.category_id) setCategoryId(suggestion.category_id);
    if (suggestion?.suggested_tdc_days) {
      setHasTdc(true);
      setTdc(addDays(todayIso(), suggestion.suggested_tdc_days));
    }
  };

  /** Clears the observation, keeping the location so the next one is quick. */
  const resetObservationFields = () => {
    setText('');
    setPhotos([]);
    setChecked([]);
    setRepeats(null);
    setError(null);
    setHasTdc(false);
    setTdc('');
    setDeficiencyId(null);
    suggested.current = '';
  };

  /** Clears the unit and the item as well, for a move to another area. */
  const nextArea = () => {
    resetObservationFields();
    setUnitId(null);
    setItemId(null);
    setItemDetail(null);
    setCoach('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const validate = (): string | null => {
    if (!typeId) return 'Select the inspection type';
    if (!isTrain && !station) return 'Select the station';
    if (isTrain && !train) return 'Select the train';
    if (text.trim().length < 5) return 'Describe the observation';
    if (!departmentId) return 'Select the department under "Action By"';
    return null;
  };

  /** Ensures an inspection exists (server side when online, locally otherwise). */
  const ensureInspection = async (): Promise<ActiveInspection> => {
    if (inspection) return inspection;
    const clientUuid = crypto.randomUUID();
    const payload = {
      module_id: selectedModule?.id,
      inspection_type_id: typeId,
      scope,
      location_type: locationType,
      station_id: isTrain ? undefined : station?.id,
      train_id: isTrain ? train?.id : undefined,
      from_time: fromTime || undefined,
      to_time: toTime || undefined,
      joint_with: jointWith || undefined,
      client_uuid: clientUuid,
    };
    if (online) {
      try {
        const created = await api.post<Inspection>('/inspections', payload);
        const record: ActiveInspection = { id: created.id, ref_no: created.ref_no, client_uuid: clientUuid };
        setInspection(record);
        return record;
      } catch (err) {
        if (!(err instanceof ApiError && err.isOffline)) throw err;
      }
    }
    await enqueue({
      client_uuid: clientUuid,
      type: 'inspection',
      payload: { ...payload, client_uuid: undefined },
      label: `${selectedModule?.name ?? 'Inspection'} - ${station?.name ?? train?.number ?? locationType}`,
    });
    const record: ActiveInspection = { client_uuid: clientUuid };
    setInspection(record);
    return record;
  };

  /**
   * Starts the inspection. The whole station goes on the sheet at once, because an
   * inspector normally attends to many of its areas and the record has to be able
   * to say which ones - including the ones found in order.
   */
  const startInspection = async () => {
    if (!typeId) {
      setError('Select the inspection type');
      return;
    }
    if (!isTrain && scope === 'station' && !station) {
      setError('Select the station');
      return;
    }
    if (isTrain && !train) {
      setError('Select the train');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const started = await ensureInspection();
      if (started.id) {
        const next = await loadSheet(started.id);
        await loadPrevious(started.id);
        toast.success(
          next
            ? `${started.ref_no} started · ${next.areas.length} areas on the sheet`
            : `${started.ref_no} started`
        );
      } else {
        toast.push('Offline - the inspection is saved on this device and will sync later', 'warn');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the inspection');
    } finally {
      setStarting(false);
    }
  };

  /** Marks a whole area: found in order, or not available at this location. */
  const markArea = async (area: InspectionArea, result: AreaResult) => {
    if (!inspection?.id) return;
    setSheetBusy(true);
    try {
      await api.patch(`/inspections/${inspection.id}/areas/${area.id}`, { result });
      await loadSheet(inspection.id);
      if (result === 'satisfactory') toast.success(`${area.unit_name} recorded as found in order`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Could not record ${area.unit_name}`);
    } finally {
      setSheetBusy(false);
    }
  };

  /** One tap: this item was checked and found in order (or does not apply). */
  const markItem = async (area: InspectionArea, item: InspectionItem, result: ItemResult) => {
    if (!inspection?.id) return;
    setSheetBusy(true);
    try {
      await api.post(`/inspections/${inspection.id}/areas/${area.id}/items`, {
        results: [{ item_id: item.id, result }],
      });
      await loadSheet(inspection.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Could not record ${item.name}`);
    } finally {
      setSheetBusy(false);
    }
  };

  /** Puts an area that is not on the sheet onto it. */
  const addArea = async (unitId: number) => {
    if (!inspection?.id) return;
    setSheetBusy(true);
    try {
      await api.post(`/inspections/${inspection.id}/sheet`, { unit_ids: [unitId] });
      await loadSheet(inspection.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not add that area');
    } finally {
      setSheetBusy(false);
    }
  };

  /**
   * Opens the observation form for one item in one area. The area and the item are
   * carried over, so the inspector writes the observation and nothing else.
   */
  const recordDeficiency = (area: InspectionArea, item: InspectionItem | null) => {
    setAreaId(area.id);
    setUnitId(area.unit_id);
    if (item) setItemId(item.id);
    setRecording(true);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  /** Records the position of an item the previous inspection left outstanding. */
  const reviewPrevious = async (item: PreviousItem, finding: PreviousFinding, remarks: string) => {
    if (!inspection?.id) return;
    setReviewBusy(item.id);
    try {
      const response = await api.post<{ moved: string | null }>(
        `/inspections/${inspection.id}/previous/${item.id}`,
        { finding, remarks: remarks || undefined }
      );
      await loadPrevious(inspection.id);
      toast.success(
        response.moved === 'closed'
          ? `${item.ref_no} verified on site and closed`
          : response.moved === 'reopened'
            ? `${item.ref_no} reopened - the department has been told`
            : `${item.ref_no} recorded as ${finding.replace('_', ' ')}`
      );
      void refreshCounters();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not record the position');
    } finally {
      setReviewBusy(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const parent = await ensureInspection();
      const parameters = checked.map((name) => ({
        parameter_id: itemDetail?.parameters?.find((p) => p.name === name)?.id ?? null,
        name,
        value: true,
      }));
      const clientUuid = crypto.randomUUID();
      const payload: Record<string, unknown> = {
        inspection_area_id: areaId ?? undefined,
        unit_id: unitId ?? undefined,
        coach: coach || undefined,
        item_id: itemId ?? undefined,
        deficiency_id: deficiencyId ?? undefined,
        observation: text.trim(),
        category_id: categoryId ?? undefined,
        severity_id: severityId ?? undefined,
        action_by_department_id: departmentId,
        supervisor_id: supervisorId ?? undefined,
        rule_reference_id: ruleId ?? undefined,
        tdc: hasTdc && tdc ? tdc : undefined,
        parameters: parameters.length ? parameters : undefined,
      };

      if (online && parent.id) {
        const created = await api.post<Observation & { notification: { recipients: number } }>('/observations', {
          ...payload, inspection_id: parent.id, client_uuid: clientUuid,
        });
        if (photos.length) {
          const form = new FormData();
          photos.forEach((p) => form.append('files', p));
          form.append('phase', 'observation');
          await api.postForm(`/observations/${created.id}/attachments`, form);
        }
        setRecorded((list) => [
          {
            id: created.id,
            ref_no: created.ref_no,
            text: created.observation,
            unit: created.unit_name,
            item: created.item_name,
            supervisor: created.supervisor_name,
          },
          ...list,
        ]);
        toast.success(
          created.supervisor_name
            ? `${created.ref_no} sent to ${created.supervisor_name} (${created.department_name})`
            : `${created.ref_no} submitted - no supervisor is mapped, the office has been informed`
        );
        void refreshCounters();
      } else {
        await enqueue(
          {
            client_uuid: clientUuid,
            type: 'observation',
            inspection_client_uuid: parent.client_uuid,
            payload,
            label: `${itemDetail?.name ?? 'Observation'} - ${units.find((u) => u.id === unitId)?.name ?? ''}`,
          },
          photos
        );
        setRecorded((list) => [
          {
            ref_no: 'Saved locally',
            text: text.trim(),
            unit: units.find((u) => u.id === unitId)?.name ?? null,
            item: itemDetail?.name ?? null,
            supervisor: autoSupervisor?.name,
            offline: true,
          },
          ...list,
        ]);
        toast.push('Offline - saved locally. It will sync automatically.', 'warn');
      }
      resetObservationFields();
      // The deficiency is on the record, so the form gets out of the way and the
      // sheet - which now shows the area as deficient - comes back.
      setRecording(false);
      setItemId(null);
      setItemDetail(null);
      if (parent.id) await loadSheet(parent.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the observation');
    } finally {
      setSubmitting(false);
    }
  };

  const completeInspection = async () => {
    if (!inspection?.id) {
      toast.warn('This inspection will be completed once it has synced');
      return;
    }
    const left = sheet?.coverage.areas_not_inspected ?? 0;
    if (
      left > 0 &&
      !window.confirm(
        `${left} area${left === 1 ? '' : 's'} on the sheet ${left === 1 ? 'has' : 'have'} not been attended to. ` +
          'They will be shown in the report as not inspected. Finish the inspection anyway?'
      )
    ) {
      return;
    }
    try {
      await api.post(`/inspections/${inspection.id}/complete`, {});
      toast.success('Inspection completed. The report is ready.');
      sessionStorage.removeItem(DRAFT_KEY);
      navigate(`/inspections/${inspection.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not complete the inspection');
    }
  };

  return (
    <form className="stack" style={{ '--gap': '14px' } as React.CSSProperties} onSubmit={submit}>
      <div className="page-head">
        <h1>{inspection ? 'Inspection in progress' : 'New Inspection'}</h1>
        <p>
          {inspection
            ? 'One inspection, every area you attend to. Mark what is in order, record what is not.'
            : 'Start the inspection, work through the areas, and the report writes itself.'}
        </p>
      </div>

      {/* Module */}
      <div className="chips" role="radiogroup" aria-label="Inspection module">
        {modules.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={m.code === moduleCode}
            className={`chip${m.code === moduleCode ? ' chip--on' : ''}`}
            onClick={() => {
              setModuleCode(m.code);
              setTypeId(null);
              setItemId(null);
              setItemDetail(null);
            }}
            disabled={!!inspection}
          >
            {m.name}
          </button>
        ))}
      </div>

      {inspection && (
        <Card
          title={inspection.ref_no ?? 'Saved on this device'}
          subtitle={[
            station?.name ?? train?.number,
            `${recorded.length} deficienc${recorded.length === 1 ? 'y' : 'ies'} recorded`,
          ]
            .filter(Boolean)
            .join(' · ')}
          icon="clipboard"
          pad={false}
          action={
            <Button size="sm" variant="ghost" icon="check" onClick={completeInspection}>
              Finish
            </Button>
          }
        >
          {sheet ? (
            <CoverageStrip coverage={sheet.coverage} />
          ) : (
            <p className="small muted" style={{ padding: '0 14px 14px' }}>
              {online
                ? 'Opening the sheet...'
                : 'Offline - the areas sheet will open when this device is back online. Deficiencies can still be recorded below.'}
            </p>
          )}
        </Card>
      )}

      {/* Once the inspection has started its context is settled, so the setup card
          folds away and the sheet has the screen. */}
      <details className="setup" open={!inspection}>
        {inspection && (
          <summary className="small">
            {[selectedModule?.name, typeOptions.find((t) => t.value === typeId)?.label,
              station?.name ?? train?.number, fromTime && `${fromTime}${toTime ? `-${toTime}` : ''}`]
              .filter(Boolean)
              .join(' · ')}
          </summary>
        )}
      <Card pad>
        <Field label="Inspection Type" required htmlFor="type">
          <SearchSelect
            id="type"
            options={typeOptions}
            value={typeId}
            onChange={(value) => setTypeId(value as number)}
            placeholder="Select inspection type"
            disabled={!!inspection}
          />
        </Field>

        {/* What kind of place this inspection covers. The areas inside it belong
            to the sheet, which is why there is no "area" to choose here. */}
        <Field label="This inspection covers" required hint="The areas within it go on the sheet once it starts">
          <div className="chips" role="radiogroup" aria-label="Inspection scope">
            {([
              ['station', 'A station', 'station'],
              ['train', 'A train', 'train'],
              ['section', 'A section', 'list'],
            ] as [InspectionScope, string, IconName][]).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                className={`chip${scope === value ? ' chip--on' : ''}`}
                disabled={!!inspection}
                onClick={() => {
                  setScope(value);
                  setUnitId(null);
                  setItemId(null);
                }}
              >
                <Icon name={icon} size={13} /> {label}
              </button>
            ))}
          </div>
        </Field>

        {isTrain ? (
          <>
            <Field label="Train" required hint="Search by train number or name">
              <SearchSelect
                options={trainOpts}
                value={train?.id ?? null}
                onChange={(value) => setTrain(trainOptions.find((t) => t.id === value) ?? null)}
                placeholder="Select train"
                searchPlaceholder="Train number or name"
                onSearch={searchTrains}
                disabled={!!inspection}
              />
            </Field>
            <Field label="Coach" hint="Optional - e.g. S-5, B-2, PC">
              <input className="input" value={coach} onChange={(e) => setCoach(e.target.value)} placeholder="Coach number" />
            </Field>
          </>
        ) : (
          <Field label="Station" required hint="Search by station name or code">
            <SearchSelect
              options={stationOpts}
              value={station?.id ?? null}
              onChange={(value) => setStation(stationOptions.find((s) => s.id === value) ?? null)}
              placeholder="Select station"
              searchPlaceholder="Station name or code"
              onSearch={searchStations}
              disabled={!!inspection}
            />
          </Field>
        )}

        {station && !isTrain && (
          <div className="row row--wrap" style={{ gap: 6, marginTop: -6, marginBottom: 12 }}>
            <Badge tone="accent">{station.division_name} Division</Badge>
            <Badge tone="outline">{station.zone_name}</Badge>
            {station.category && <Badge tone="outline">{station.category}</Badge>}
            {station.station_type && <Badge tone="outline">{station.station_type}</Badge>}
            {station.platforms ? <Badge tone="outline">{station.platforms} platforms</Badge> : null}
          </div>
        )}

        {!inspection && (
          <>
            <div className="row row--wrap" style={{ gap: 10 }}>
              <Field label="From" hint="Clock time of the visit">
                <input className="input" type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
              </Field>
              <Field label="To">
                <input className="input" type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
              </Field>
            </div>
            <Field label="Accompanied by" hint="Officers and staff present during the inspection - optional">
              <input
                className="input"
                value={jointWith}
                onChange={(e) => setJointWith(e.target.value)}
                placeholder="e.g. Station Manager / Bilaspur"
              />
            </Field>
          </>
        )}
      </Card>
      </details>

      {/* Before the inspection exists there is nothing to inspect: one button. */}
      {!inspection && (
        <>
          {error && <Banner tone="danger">{error}</Banner>}
          <Button size="lg" block icon="clipboard" loading={starting} onClick={startInspection}>
            START INSPECTION
          </Button>
          <p className="xsmall muted center">
            Every area of the {isTrain ? 'train' : 'station'} goes on the sheet. Mark what you attend to;
            whatever you do not is recorded as not inspected.
          </p>
        </>
      )}

      {/* Part I: what the last inspection of this place left outstanding. */}
      {inspection && previous && (
        <PreviousReview
          previousRef={previous.previous?.ref_no ?? null}
          items={previous.items}
          onReview={reviewPrevious}
          busyId={reviewBusy}
        />
      )}

      {/* Part II: the areas. This is the spine of the inspection. */}
      {inspection && sheet && (
        <AreaSheet
          areas={sheet.areas}
          openAreaId={openAreaId}
          onOpenArea={setOpenAreaId}
          onAreaResult={markArea}
          onItemResult={markItem}
          onRecordDeficiency={recordDeficiency}
          availableAreas={sheet.available_areas}
          onAddArea={addArea}
          busy={sheetBusy}
        />
      )}

      {/* Offline, or recording something the sheet does not cover: pick by hand. */}
      {inspection && recording && !sheet && (
        <Card pad title="Where" icon="station">
          <Field label="Unit / Area" hint={units.length ? `${units.length} areas available` : 'Select a station first'}>
            <SearchSelect
              options={unitOpts}
              value={unitId}
              onChange={(value) => setUnitId(value as number | null)}
              placeholder="Select unit or area"
              disabled={unitOpts.length === 0}
            />
          </Field>
          <Field
            label={moduleCode === 'PA' ? 'Amenity / Service' : 'Inspection Item'}
            hint={items ? `${items.data.length} items in ${selectedModule?.name}` : 'Loading items'}
          >
            <SearchSelect
              options={itemOpts}
              value={itemId}
              onChange={(value) => setItemId(value as number | null)}
              placeholder="Select item"
              searchPlaceholder="Type to search items"
            />
          </Field>
        </Card>
      )}

      {inspection && !recording && (
        <Button variant="quiet" block icon="edit" onClick={() => setRecording(true)}>
          Record a deficiency not on the sheet
        </Button>
      )}

      {inspection && recording && itemDetail?.parameters && itemDetail.parameters.length > 0 && (
        <Card pad>
          <details open>
            <summary className="small strong" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
              Checklist for {itemDetail.name} ({checked.length} selected)
            </summary>
            <div style={{ marginTop: 8 }}>
              {itemDetail.parameters.map((p) => (
                <label className="checkline" key={p.id}>
                  <input
                    type="checkbox"
                    checked={checked.includes(p.name)}
                    onChange={(e) =>
                      setChecked((list) => (e.target.checked ? [...list, p.name] : list.filter((n) => n !== p.name)))
                    }
                  />
                  <span className="small">
                    {p.name}
                    {p.polarity === 'negative' && <span className="muted"> (deficiency)</span>}
                  </span>
                </label>
              ))}
            </div>
          </details>
        </Card>
      )}

      {/* The observation form. It stays out of the way until the inspector says
          something is wrong, so the screen is the sheet rather than a form. */}
      {inspection && recording && (
        <div ref={formRef} className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
          <div className="row row--wrap" style={{ gap: 8 }}>
            <strong className="small">
              Recording a deficiency
              {sheet && areaId
                ? ` in ${sheet.areas.find((a) => a.id === areaId)?.unit_name ?? ''}`
                : ''}
              {itemDetail ? ` · ${itemDetail.name}` : ''}
            </strong>
            <span className="spacer" />
            <Button size="sm" variant="quiet" icon="close" onClick={() => { setRecording(false); resetObservationFields(); }}>
              Cancel
            </Button>
          </div>
      {/* Repeated deficiency warning */}
          {repeats && repeats.count > 0 && (
            <Banner tone="warn" icon="repeat">
              <div>
                <strong>Repeated observation.</strong> {repeats.message}
              </div>
              <div className="stack" style={{ '--gap': '4px', marginTop: 6 } as React.CSSProperties}>
                {repeats.matches.slice(0, 3).map((m) => (
                  <Link key={m.id} to={`/observations/${m.id}`} className="xsmall" style={{ color: 'inherit' }}>
                    {m.ref_no} · {formatDate(m.observed_at)} · {m.match_reason} · {m.status}
                  </Link>
                ))}
              </div>
            </Banner>
          )}

          {norms.length > 0 && (
            <Banner tone={norms.some((n) => !n.meets_norm) ? 'warn' : 'info'} icon="clipboard">
              <div className="small">
                <strong>Minimum essential amenities</strong> at {station?.name}
              </div>
              <div className="stack" style={{ '--gap': '3px', marginTop: 5 } as React.CSSProperties}>
                {norms.map((n) => (
                  <div key={n.id} className="row row--wrap xsmall" style={{ gap: 8 }}>
                    <span style={{ minWidth: 150 }}>{n.item_label}</span>
                    {n.unit === 'yes/no' ? (
                      <span>
                        {n.provided ? 'provided' : 'not provided'}
                        {n.required ? ' · required' : ' · not required'}
                      </span>
                    ) : (
                      <span>
                        <b className="mono-num">{n.provided}</b> provided against{' '}
                        <b className="mono-num">{n.required}</b> required ({n.unit})
                      </span>
                    )}
                    {n.meets_norm ? (
                      <Badge tone="good">Meets the norm</Badge>
                    ) : (
                      <Badge tone="critical">
                        Short by {n.unit === 'yes/no' ? 'provision' : n.shortfall}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </Banner>
          )}

          {/* Observation - the most prominent input */}
          <Card title="Observation" icon="edit">
            {itemId && deficiencyOpts.length > 0 && (
              <Field
                label="Suggested deficiency"
                hint="Pick what was found and the wording, department and TDC are filled in - all of it stays editable"
              >
                <SearchSelect
                  options={deficiencyOpts}
                  value={deficiencyId}
                  onChange={pickDeficiency}
                  placeholder="Choose a common deficiency, or type your own below"
                  searchPlaceholder="Search deficiencies"
                />
              </Field>
            )}
            <textarea
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Describe the observation..."
              aria-label="Observation"
              required
              style={{ minHeight: 128, fontSize: '1rem' }}
            />
            <div className="row row--wrap" style={{ marginTop: 10, gap: 8 }}>
              {speechSupported() && (
                <Button
                  variant={listening ? 'danger' : 'quiet'}
                  icon="mic"
                  onClick={toggleVoice}
                  size="sm"
                >
                  {listening ? 'Stop dictation' : 'Voice input'}
                </Button>
              )}
              <span className="xsmall muted">
                {text.trim().length > 0 ? `${text.trim().length} characters` : 'Type, dictate or add a photograph'}
              </span>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="section-label">Photo / evidence</div>
              <PhotoPicker files={photos} onChange={setPhotos} label="Add photo" />
            </div>
          </Card>

          {/* Responsibility */}
          <Card title="Responsibility" icon="users">
            <Field label="Action By" required>
              <SearchSelect
                options={departmentOpts}
                value={departmentId}
                onChange={(value) => setDepartmentId(value as number | null)}
                placeholder="Select department"
              />
            </Field>

            <Field
              label="Concerned Supervisor"
              hint={
                resolvingSupervisor
                  ? 'Identifying the concerned supervisor...'
                  : autoSupervisor
                    ? `Auto selected: ${autoSupervisor.match_reason}`
                    : departmentId
                      ? 'No supervisor is mapped for this combination - the divisional office will be informed'
                      : 'Select the department first'
              }
            >
              <SearchSelect
                options={supervisorOpts}
                value={supervisorId}
                onChange={(value) => setSupervisorId(value as number | null)}
                placeholder={resolvingSupervisor ? 'Resolving...' : 'Auto selected'}
                searchPlaceholder="Search supervisors"
                disabled={supervisorOpts.length === 0}
                loading={resolvingSupervisor}
              />
            </Field>

            {supervisorId && (
              <div className="row row--wrap small" style={{ gap: 8, marginTop: -6 }}>
                {(() => {
                  const s = supervisors.find((x) => x.id === supervisorId);
                  if (!s) return null;
                  return (
                    <>
                      <Badge tone="accent"><Icon name="user" size={11} /> {s.designation ?? 'Supervisor'}</Badge>
                      {s.mobile && <Badge tone="outline">{s.mobile}</Badge>}
                      {s.station_name && <Badge tone="outline">{s.station_name}</Badge>}
                    </>
                  );
                })()}
              </div>
            )}

            <Field
              label="TDC - Target Date of Compliance"
              hint={hasTdc ? 'Reminders and escalation follow the configured rules' : 'Optional'}
            >
              <div className="chips" style={{ marginBottom: hasTdc ? 10 : 0 }}>
                <button type="button" className={`chip${!hasTdc ? ' chip--on' : ''}`} onClick={() => setHasTdc(false)}>
                  No TDC
                </button>
                <button type="button" className={`chip${hasTdc ? ' chip--on' : ''}`} onClick={() => setHasTdc(true)}>
                  <Icon name="calendar" size={13} /> Select date
                </button>
                {severity?.default_tdc_days && !hasTdc && (
                  <span className="xsmall muted" style={{ alignSelf: 'center' }}>
                    {severity.name} usually {severity.default_tdc_days} day{severity.default_tdc_days === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              {hasTdc && (
                <input
                  className="input"
                  type="date"
                  value={tdc}
                  min={todayIso()}
                  onChange={(e) => setTdc(e.target.value)}
                />
              )}
            </Field>

            <button type="button" className="chart__toggle" style={{ marginLeft: 0 }} onClick={() => setShowMore((v) => !v)}>
              {showMore ? 'Hide' : 'Show'} severity, category and rule reference
            </button>

            {showMore && (
              <div style={{ marginTop: 12 }}>
                <Field label="Severity">
                  <div className="chips">
                    {(masters?.severities ?? []).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`chip${severityId === s.id ? ' chip--on' : ''}`}
                        onClick={() => setSeverityId(s.id)}
                        title={s.definition ?? undefined}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                  {severity?.definition && <div className="field__hint">{severity.definition}</div>}
                </Field>
                <Field label="Observation Category">
                  <SearchSelect
                    options={(masters?.observation_categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
                    value={categoryId}
                    onChange={(value) => setCategoryId(value as number | null)}
                    placeholder="Select category"
                  />
                </Field>
                <Field label="Linked rule / instruction" hint="Railway Board or divisional instruction this observation refers to">
                  <SearchSelect
                    options={(masters?.rule_references ?? []).map((r) => ({
                      value: r.id, label: `${r.code} - ${r.title}`, sub: r.authority ?? undefined,
                    }))}
                    value={ruleId}
                    onChange={(value) => setRuleId(value as number | null)}
                    placeholder="No rule linked"
                  />
                </Field>
              </div>
            )}
          </Card>

          {error && <Banner tone="danger">{error}</Banner>}

          <div
            style={{
              position: 'sticky', bottom: 'calc(var(--nav-h) + 8px)', zIndex: 10,
              background: 'var(--plane)', paddingTop: 6,
            }}
          >
            <Button type="submit" size="lg" block loading={submitting} icon="send">
              {recorded.length > 0 ? `SUBMIT OBSERVATION ${recorded.length + 1}` : 'SUBMIT OBSERVATION'}
            </Button>
            {recorded.length > 0 && (
              <div className="row row--wrap" style={{ gap: 8, marginTop: 8 }}>
                <Button size="sm" variant="quiet" icon="plus" onClick={nextArea}>
                  Next area / item
                </Button>
                <span className="spacer" />
                <Button size="sm" variant="ghost" icon="check" onClick={completeInspection}>
                  Finish inspection
                </Button>
              </div>
            )}
            {!online && (
              <div className="xsmall center muted" style={{ marginTop: 6 }}>
                <Icon name="offline" size={12} /> Offline - the observation will be saved on this device and synced later
              </div>
            )}
          </div>
        </div>
      )}

      {recorded.length > 0 && (
        <Card
          title={`Recorded in this inspection (${recorded.length})`}
          subtitle="One inspection carries as many observations as the inspection found"
          pad={false}
          action={
            inspection?.id ? (
              <Link className="btn btn--sm btn--quiet" to={`/inspections/${inspection.id}/note`}>
                <Icon name="file" size={13} /> Inspection note
              </Link>
            ) : undefined
          }
        >
          <div style={{ padding: '4px 0' }}>
            {recorded.map((r, index) => (
              <div key={`${r.ref_no}-${index}`} style={{ padding: '9px 14px', borderBottom: '1px solid var(--line)' }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="obs__num">{recorded.length - index}</span>
                  {r.id ? (
                    <Link to={`/observations/${r.id}`} className="obs__ref">{r.ref_no}</Link>
                  ) : (
                    <span className="obs__ref">{r.ref_no}</span>
                  )}
                  {r.offline && <Badge tone="warning">Saved locally</Badge>}
                  {r.supervisor && <span className="xsmall muted truncate">→ {r.supervisor}</span>}
                </div>
                {(r.unit || r.item) && (
                  <div className="xsmall muted" style={{ marginTop: 2 }}>
                    {[r.unit, r.item].filter(Boolean).join(' · ')}
                  </div>
                )}
                <div className="small clamp-2" style={{ marginTop: 2 }}>{r.text}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {user?.role === 'supervisor' && (
        <Banner tone="info">
          You are signed in as a supervisor. Observations you raise are recorded against your own name; compliance
          items assigned to you are in the Compliance queue.
        </Banner>
      )}

      {resolvingSupervisor && <div className="sr-only" role="status">Identifying the concerned supervisor</div>}
      {submitting && <div className="sr-only" role="status">Submitting <Spinner size={12} /></div>}
    </form>
  );
}
