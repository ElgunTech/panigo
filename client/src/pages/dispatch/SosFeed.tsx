import { useState } from 'react';
import clsx from 'clsx';
import { Accessibility, Radio } from 'lucide-react';
import type { Brigade, LatLng, SosSignal, Zone } from '@shared/types';
import { useI18n } from '../../i18n';
import { HAZARD_COLOR, timeAgo } from '../../lib/format';
import { HazardIcon } from '../../components/ui';
import type { Ops } from '../Dispatch';

export function SosFeed({ sos, brigades, zones, ops, onFocus }: { sos: SosSignal[]; brigades: Brigade[]; zones: Zone[]; ops: Ops; onFocus: (p: LatLng) => void }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  // Priority #1 (special-needs) signals always on top, then newest first
  const list = (filter === 'open' ? sos.filter((s) => s.status === 'new' || s.status === 'assigned') : sos)
    .slice()
    .sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2) || b.createdAt - a.createdAt)
    .slice(0, 80);
  const free = brigades.filter((b) => b.status === 'available');
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
          <li key={s.id} className={clsx('group flex items-center gap-2.5 rounded-lg border px-2.5 py-2', s.priority === 1 && s.status !== 'resolved' && s.status !== 'cancelled' ? 'border-violet-500/50 bg-violet-950/40' : 'border-white/5 bg-ink-850 hover:border-white/10')}>
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
                {t.hazard[s.hazard]} <span className="font-normal text-slate-500">· {zoneName(s.zoneId)}</span>
              </div>
              <div className="text-[10px] text-slate-500">
                {timeAgo(s.createdAt, t.common)} · <span className={clsx(s.status === 'new' && 'text-red-400', s.status === 'assigned' && 'text-amber-400', s.status === 'resolved' && 'text-emerald-400')}>{t.sosStatus[s.status]}</span>
                {s.brigadeId && ` · ${brigades.find((b) => b.id === s.brigadeId)?.name ?? ''}`}
                {s.confirmedAt ? (
                  <span className="ml-1 rounded bg-emerald-500/20 px-1 py-px font-semibold text-emerald-300">✓ {t.dispatch.confirmedBadge}</span>
                ) : s.arrivedAt && s.status === 'assigned' ? (
                  <span className="ml-1 rounded bg-violet-500/20 px-1 py-px font-semibold text-violet-300">{t.dispatch.arrivedBadge}</span>
                ) : null}
              </div>
            </div>
            {s.status === 'new' && free.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => e.target.value && ops.assign(e.target.value, [s.id]).catch(() => undefined)}
                className="w-24 shrink-0 rounded-md border border-white/10 bg-ink-900 px-1.5 py-1 text-[10px] text-slate-200"
                aria-label={t.dispatch.assign}
              >
                <option value="">{t.dispatch.assign}…</option>
                {free.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
