import { useState } from 'react';
import clsx from 'clsx';
import { Accessibility, HeartPulse, Loader2, Navigation, Radio } from 'lucide-react';
import type { Brigade, BrigadeType, Hazard, LatLng, SosSignal, Zone } from '@shared/types';
import { useI18n } from '../../i18n';
import { distanceM, fmtDistance, HAZARD_COLOR, timeAgo } from '../../lib/format';
import { HazardIcon } from '../../components/ui';
import type { Ops } from '../Dispatch';

/** Same rule as the server: which unit type fits the hazard (Priority #1 → medical). */
const WANTED: Record<Hazard, BrigadeType> = { medical: 'medical', fire: 'fire', collapse: 'rescue', flood: 'rescue' };
export const wantedType = (s: SosSignal): BrigadeType => (s.priority === 1 ? 'medical' : WANTED[s.hazard]);

/** Free units for an SOS: matching type first, then by distance (preview — the server decides by road ETA). */
export function rankUnits(s: SosSignal, brigades: Brigade[]) {
  const wanted = wantedType(s);
  return brigades
    .filter((b) => b.status === 'available' || b.status === 'returning')
    .map((b) => ({ b, d: distanceM(b.location, s.location), match: b.type === wanted }))
    .sort((x, y) => Number(y.match) - Number(x.match) || x.d - y.d);
}

export function SosFeed({ sos, brigades, zones, ops, onFocus }: { sos: SosSignal[]; brigades: Brigade[]; zones: Zone[]; ops: Ops; onFocus: (p: LatLng) => void }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  // Priority #1 (special-needs) signals always on top, then newest first
  const list = (filter === 'open' ? sos.filter((s) => s.status === 'new' || s.status === 'assigned') : sos)
    .slice()
    .sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2) || b.createdAt - a.createdAt)
    .slice(0, 80);
  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? id;

  return (
    <section className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          <Radio className="h-3.5 w-3.5" /> {t.dispatch.sosFeed}
        </h2>
        <div className="flex rounded-md bg-white/5 p-0.5 text-[10px] font-semibold">
          {(['open', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={clsx('rounded px-2 py-0.5', filter === f ? 'bg-white/15 text-white' : 'text-slate-400')}>
              {f === 'open' ? t.dispatch.filterOpen : t.dispatch.filterAll}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 && <div className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-500">{t.dispatch.noSos}</div>}
      <ul className="space-y-1.5">
        {list.map((s) => (
          <li key={s.id} className={clsx('group rounded-lg border px-2.5 py-2', s.priority === 1 && s.status !== 'resolved' && s.status !== 'cancelled' ? 'border-violet-500/50 bg-violet-950/40' : 'border-white/5 bg-ink-850 hover:border-white/10')}>
            <div className="flex items-center gap-2.5">
              <button onClick={() => onFocus(s.location)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-white" style={{ background: HAZARD_COLOR[s.hazard] }} aria-label={t.common.focus}>
                <HazardIcon hazard={s.hazard} className="h-3.5 w-3.5" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  {s.priority === 1 && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-violet-500 px-1 py-px text-[9px] font-extrabold text-white" title={t.dispatch.specialNeeds}>
                      <Accessibility className="h-2.5 w-2.5" /> {t.dispatch.p1}
                    </span>
                  )}
                  <span className="truncate">{t.hazard[s.hazard]}</span> <span className="shrink-0 font-normal text-slate-500">· {zoneName(s.zoneId)}</span>
                </div>
                <div className="text-[10px] text-slate-500">
                  {timeAgo(s.createdAt, t.common)} · <span className={clsx(s.status === 'new' && 'text-red-400', s.status === 'assigned' && 'text-amber-400', s.status === 'resolved' && 'text-emerald-400')}>{t.sosStatus[s.status]}</span>
                  {s.brigadeId && ` · ${brigades.find((b) => b.id === s.brigadeId)?.name.split(' · ')[0] ?? ''}`}
                  {s.vitals && (
                    <span
                      className={clsx('ml-1 inline-flex items-center gap-0.5 rounded px-1 py-px font-semibold', s.vitals.abnormal ? 'animate-pulse bg-red-500/25 text-red-300' : 'bg-rose-500/15 text-rose-300')}
                      title={`${t.pulse.camera}, ${t.pulse.estimate} · ${Math.round(s.vitals.quality * 100)}%`}
                    >
                      <HeartPulse className="h-2.5 w-2.5" />~{s.vitals.bpm} {t.pulse.bpm}
                      <span className="font-normal opacity-70">({t.pulse.estimate})</span>
                    </span>
                  )}
                  {s.confirmedAt ? (
                    <span className="ml-1 rounded bg-emerald-500/20 px-1 py-px font-semibold text-emerald-300">✓ {t.dispatch.confirmedBadge}</span>
                  ) : s.arrivedAt && s.status === 'assigned' ? (
                    <span className="ml-1 rounded bg-violet-500/20 px-1 py-px font-semibold text-violet-300">{t.dispatch.arrivedBadge}</span>
                  ) : null}
                </div>
              </div>
            </div>
            {s.status === 'new' && <AssignControls sos={s} brigades={brigades} ops={ops} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One click → nearest suitable unit (server picks by road ETA); manual override sorted by distance. */
function AssignControls({ sos, brigades, ops }: { sos: SosSignal; brigades: Brigade[]; ops: Ops }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const ranked = rankUnits(sos, brigades);
  const best = ranked[0];
  if (!best) return <div className="mt-1.5 pl-9 text-[10px] text-amber-400">{t.dispatch.noFreeUnit}</div>;

  const nearest = async () => {
    setBusy(true);
    await ops.assignNearest(sos.id).catch(() => undefined);
    setBusy(false);
  };

  return (
    <div className="mt-1.5 flex items-center gap-1.5 pl-9">
      <button
        onClick={nearest}
        disabled={busy}
        title={`${t.dispatch.assignNearest}: ${best.b.name} · ${fmtDistance(best.d, t.common)}${best.match ? '' : ` (${t.dispatch.otherType})`}`}
        aria-label={`${t.dispatch.assignNearest}: ${best.b.name}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-red-500/90 px-2 py-1.5 text-left text-[11px] font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Navigation className="h-3 w-3 shrink-0" />}
        <span className="shrink-0">{t.dispatch.assignShort} →</span>
        <span className="min-w-0 truncate">{best.b.name.split(' · ')[0]}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] font-normal opacity-90">{fmtDistance(best.d, t.common)}</span>
        {!best.match && <span className="shrink-0 rounded bg-amber-400/30 px-1 text-[9px]">!</span>}
      </button>
      <select
        value=""
        onChange={(e) => e.target.value && ops.assign(e.target.value, [sos.id]).catch(() => undefined)}
        className="w-16 shrink-0 rounded-md border border-white/10 bg-ink-900 px-1 py-1.5 text-[10px] text-slate-300"
        aria-label={t.dispatch.manualPick}
      >
        <option value="">{t.dispatch.manualPick}</option>
        {ranked.map(({ b, d, match }) => (
          <option key={b.id} value={b.id}>
            {match ? '★ ' : ''}
            {b.name.split(' · ')[0]} · {fmtDistance(d, t.common)}
          </option>
        ))}
      </select>
    </div>
  );
}
