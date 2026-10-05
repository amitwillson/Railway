import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useToast } from '../state/ToastContext';
import Icon from './Icon';
import { Badge, Banner, Button, Card, EmptyState, Loading } from './ui';
import type { Jurisdiction, JurisdictionPayload } from '../api/types';

/**
 * Where an officer works, chosen by the officer.
 *
 * An inspector says which sections and stations they inspect; a supervisor says
 * which they look after. The division's own record of who answers for what is a
 * separate thing, maintained by an administrator, and this never overrides it -
 * the screen says so plainly, because a supervisor needs to know that ticking a
 * station does not take work away from the person the division nominated.
 *
 * Sections are the normal unit: a division has eight of them and ninety stations,
 * so an officer picks a section and gets its stations, and names individual
 * stations only where their patch does not follow a section.
 */
export default function JurisdictionPicker({
  userId, readOnly, onSaved,
}: {
  /** Whose jurisdiction. Omitted means my own. */
  userId?: number;
  readOnly?: boolean;
  onSaved?: (rows: Jurisdiction[]) => void;
}) {
  const toast = useToast();
  const path = userId ? `/profile/jurisdiction/${userId}` : '/profile/jurisdiction';

  const [payload, setPayload] = useState<JurisdictionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState<string[]>([]);
  const [stations, setStations] = useState<number[]>([]);
  const [divisions, setDivisions] = useState<number[]>([]);
  const [primary, setPrimary] = useState<{ kind: string; value: string | number } | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Loads what is held now and seeds the form from it. */
  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get<JurisdictionPayload>(path)
      .then((data) => {
        if (!live) return;
        setPayload(data);
        setSections(data.data.filter((r) => r.kind === 'section' && r.section).map((r) => r.section!));
        setStations(data.data.filter((r) => r.kind === 'station' && r.station_id).map((r) => r.station_id!));
        setDivisions(data.data.filter((r) => r.kind === 'division' && r.division_id).map((r) => r.division_id!));
        const first = data.data.find((r) => r.is_primary);
        setPrimary(
          first
            ? {
                kind: first.kind,
                value: first.kind === 'section' ? first.section! : first.kind === 'station' ? first.station_id! : first.division_id!,
              }
            : null
        );
      })
      .catch(() => setPayload(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path]);

  const choices = payload?.choices;

  /** The stations of each section, so a section can be opened and refined. */
  const bySection = useMemo(() => {
    const map = new Map<string, typeof choices extends undefined ? never : NonNullable<typeof choices>['stations']>();
    for (const station of choices?.stations ?? []) {
      const key = station.section ?? 'Not on a section';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(station);
    }
    return map;
  }, [choices]);

  /** How many stations the current selection works out to. */
  const covered = useMemo(() => {
    const ids = new Set(stations);
    for (const code of sections) for (const s of bySection.get(code) ?? []) ids.add(s.id);
    if (divisions.length) for (const s of choices?.stations ?? []) ids.add(s.id);
    return ids.size;
  }, [sections, stations, divisions, bySection, choices]);

  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await api.put<{ data: Jurisdiction[]; stations_covered: number }>(path, {
        sections, stations, divisions, primary,
      });
      setPayload((p) => (p ? { ...p, data: response.data, stations_covered: response.stations_covered } : p));
      toast.success(
        response.stations_covered
          ? `Jurisdiction saved · ${response.stations_covered} station${response.stations_covered === 1 ? '' : 's'}`
          : 'Jurisdiction cleared'
      );
      onSaved?.(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the jurisdiction');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading jurisdiction" />;
  if (!payload) {
    return (
      <Card>
        <EmptyState icon="alert" title="Jurisdiction unavailable" />
      </Card>
    );
  }

  const live = payload.data;
  const adminSet = live.some((r) => r.source === 'admin');

  return (
    <Card
      title="My jurisdiction"
      subtitle={
        readOnly
          ? `${payload.user.name} covers ${payload.stations_covered} station${payload.stations_covered === 1 ? '' : 's'}`
          : 'The sections and stations you work. It decides what the screens offer you first.'
      }
      icon="station"
      pad={false}
    >
      {/* What is held now */}
      <div style={{ padding: '0 14px 12px' }}>
        {live.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            Nothing chosen yet, so every station of the division is offered.
          </p>
        ) : (
          <div className="row row--wrap" style={{ gap: 6 }}>
            {live.map((row) => (
              <Badge key={row.id} tone={row.is_primary ? 'accent' : 'outline'}>
                {row.kind === 'section'
                  ? `${row.section}${row.section_name ? ` · ${row.section_name}` : ''}`
                  : row.kind === 'station'
                    ? `${row.station_name} (${row.station_code})`
                    : `${row.division_name} division`}
                {row.source === 'admin' && ' · set by the office'}
              </Badge>
            ))}
          </div>
        )}
        <div className="xsmall muted" style={{ marginTop: 8 }}>
          <b className="mono-num">{payload.stations_covered}</b> station
          {payload.stations_covered === 1 ? '' : 's'} covered
          {adminSet && ' · some of this was set by the office'}
        </div>
      </div>

      {readOnly ? null : (
        <>
          <Banner tone="info">
            This is your own statement of where you work. The division's record of who answers for which
            station is kept separately by the office, and nothing you choose here overrides it &mdash; a
            station you add can only bring work to you where that record is silent.
          </Banner>

          {/* Whole division */}
          {(choices?.divisions ?? []).length > 0 && (
            <div style={{ padding: '12px 14px 0' }}>
              <div className="section-label">The whole division</div>
              <div className="chips">
                {choices!.divisions.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`chip${divisions.includes(d.id) ? ' chip--on' : ''}`}
                    onClick={() => toggle(divisions, d.id, setDivisions)}
                  >
                    {d.name} division
                  </button>
                ))}
                <span className="xsmall muted" style={{ alignSelf: 'center' }}>
                  For an officer who inspects anywhere in it
                </span>
              </div>
            </div>
          )}

          {/* Sections, each opening to its stations */}
          <div style={{ padding: '12px 14px 0' }}>
            <div className="section-label">
              Sections
              {divisions.length > 0 && (
                <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>
                  {' '}&mdash; the whole division is selected, so these are covered already. Tick one
                  anyway to name it as your own section.
                </span>
              )}
            </div>
            {(choices?.sections ?? []).map((section) => {
              const on = sections.includes(section.code);
              const open = openSection === section.code;
              const inSection = bySection.get(section.code) ?? [];
              const picked = inSection.filter((s) => stations.includes(s.id)).length;
              // Choosing the whole division already covers every section, and a
              // section already covers its stations, so the narrower choice is drawn
              // as covered rather than as picked. It stays tickable, because naming it
              // outright still says something: it is this officer's own patch, it can
              // be the default the screens open on, and for a supervisor it is a
              // closer claim than the wider one.
              const byDivision = divisions.length > 0;
              const covers = on || byDivision;
              return (
                <div className="sheet-group" key={section.code} style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="row" style={{ gap: 8, padding: '8px 0', alignItems: 'center' }}>
                    <button
                      type="button"
                      className={`chip${on ? ' chip--on' : byDivision ? ' chip--covered' : ''}`}
                      title={
                        byDivision && !on
                          ? 'Already covered by the whole division - tick it to name it as your own section too'
                          : undefined
                      }
                      onClick={() => {
                        toggle(sections, section.code, setSections);
                        // A whole section makes the individual picks redundant.
                        if (!on) setStations((list) => list.filter((id) => !inSection.some((s) => s.id === id)));
                      }}
                    >
                      {section.code}
                    </button>
                    <span className="small" style={{ flex: 1, minWidth: 0 }}>
                      {section.name}
                      <span className="muted"> · {section.station_count} stations</span>
                      {byDivision
                        ? <span className="muted"> · covered by the division</span>
                        : !on && picked > 0 && <span className="muted"> · {picked} picked</span>}
                    </span>
                    <button
                      type="button"
                      className="chart__toggle"
                      style={{ marginLeft: 0 }}
                      onClick={() => setOpenSection(open ? null : section.code)}
                    >
                      {open ? 'Hide' : 'Stations'}
                    </button>
                  </div>
                  {open && (
                    <div className="chips" style={{ paddingBottom: 10 }}>
                      {inSection.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`chip chip--xs${
                            stations.includes(s.id) ? ' chip--on' : covers ? ' chip--covered' : ''
                          }`}
                          title={
                            covers && !stations.includes(s.id)
                              ? `Already covered by ${
                                  on ? 'the whole section' : 'the whole division'
                                } - tick it to name it outright too`
                              : undefined
                          }
                          onClick={() => toggle(stations, s.id, setStations)}
                        >
                          {s.name}
                        </button>
                      ))}
                      {inSection.length === 0 && <span className="xsmall muted">No stations on this section</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Which one the screens should default to */}
          {(sections.length > 0 || stations.length > 0) && (
            <div style={{ padding: '14px 14px 0' }}>
              <div className="section-label">Default to</div>
              <div className="chips">
                <button
                  type="button"
                  className={`chip${primary === null ? ' chip--on' : ''}`}
                  onClick={() => setPrimary(null)}
                >
                  No default
                </button>
                {sections.map((code) => (
                  <button
                    key={`s-${code}`}
                    type="button"
                    className={`chip${primary?.kind === 'section' && primary.value === code ? ' chip--on' : ''}`}
                    onClick={() => setPrimary({ kind: 'section', value: code })}
                  >
                    {code}
                  </button>
                ))}
                {stations.map((id) => {
                  const station = choices?.stations.find((s) => s.id === id);
                  return (
                    <button
                      key={`t-${id}`}
                      type="button"
                      className={`chip${primary?.kind === 'station' && primary.value === id ? ' chip--on' : ''}`}
                      onClick={() => setPrimary({ kind: 'station', value: id })}
                    >
                      {station?.name ?? id}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding: '12px 14px 0' }}>
              <Banner tone="danger">{error}</Banner>
            </div>
          )}

          <div className="row row--wrap" style={{ gap: 10, padding: 14, alignItems: 'center' }}>
            <Button icon="check" loading={saving} onClick={save}>Save jurisdiction</Button>
            <span className="small muted">
              <Icon name="station" size={12} /> {covered} station{covered === 1 ? '' : 's'} selected
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
