import { useState } from 'react';
import clsx from 'clsx';
import { Accessibility, Ambulance, BellRing, CheckCircle2, Loader2, MapPinPlus, ShieldAlert, XCircle } from 'lucide-react';
import type { CrisisAlert, LatLng } from '@shared/types';
import { useI18n } from '../../i18n';
import type { LiveState } from '../../lib/liveState';
import { timeAgo } from '../../lib/format';
import type { Ops } from '../Dispatch';

export function AlertsPanel({ alerts, state, ops, onFocus }: { alerts: CrisisAlert[]; state: LiveState; ops: Ops; onFocus: (p: LatLng) => void }) {
  const { t } = useI18n();
  const open = alerts.filter((a) => a.status === 'open');
  const recent = alerts.filter((a) => a.status !== 'open').slice(0, 4);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          <BellRing className={clsx('h-3.5 w-3.5', open.length && 'animate-pulse text-red-400')} /> {t.dispatch.alerts}
          {open.length > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] text-white">{open.length}</span>}
        </h2>
      </div>
      <p className="mb-2 px-1 text-[10px] leading-snug text-slate-500">{t.dispatch.rules}</p>
      {open.length === 0 && <div className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-500">{t.dispatch.noAlerts}</div>}
      <div className="space-y-2">
        {open.map((a) => (
          <AlertCard key={a.id} alert={a} state={state} ops={ops} onFocus={onFocus} />
        ))}
        {recent.map((a) => (
          <AlertCard key={a.id} alert={a} state={state} ops={ops} onFocus={onFocus} />
        ))}
      </div>
    </section>
  );
}

function AlertCard({ alert: a, state, ops, onFocus }: { alert: CrisisAlert; state: LiveState; ops: Ops; onFocus: (p: LatLng) => void }) {
  const { t, fmt } = useI18n();
  const [busy, setBusy] = useState<'exec' | 'dismiss' | null>(null);
  const [err, setErr] = useState('');
  const zone = state.zones.find((z) => z.id === a.zoneId)?.name ?? a.zoneId;
  const point = a.pointId ? state.points[a.pointId] : undefined;
  const brigade = a.recommendation.brigadeId ? state.brigades[a.recommendation.brigadeId] : undefined;
  const newPoint = a.recommendation.newPointId ? state.points[a.recommendation.newPointId] : undefined;
  const isOpen = a.status === 'open';

  const run = async (kind: 'exec' | 'dismiss') => {
    setBusy(kind);
    setErr('');
    try {
      if (kind === 'exec') await ops.execute(a.id);
      else await ops.dismiss(a.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const priority = a.kind === 'priority_sos';
  const title = priority
    ? fmt(t.dispatch.alertPriority, { zone })
    : a.kind === 'sos_cluster'
      ? fmt(t.dispatch.alertCluster, { zone, n: a.distinctCitizens })
      : fmt(t.dispatch.alertCapacity, { point: point?.name ?? '', pct: (a.occupancyPct ?? 0).toFixed(0) });

  return (
    <article
      className={clsx(
        'animate-slideIn rounded-xl border p-3 transition',
        isOpen && priority && 'animate-pulseRing border-violet-400/70 bg-gradient-to-br from-violet-600/30 to-red-950/40',
        isOpen && !priority && 'animate-pulseRing border-red-500/60 bg-gradient-to-br from-red-600/25 to-red-950/40',
        !isOpen && 'border-white/5 bg-ink-850 opacity-70',
      )}
    >
      <button onClick={() => onFocus(a.center)} className="flex w-full items-start gap-2 text-left">
        {priority ? (
          <Accessibility className={clsx('mt-0.5 h-4 w-4 shrink-0', isOpen ? 'text-violet-300' : 'text-slate-500')} />
        ) : (
          <ShieldAlert className={clsx('mt-0.5 h-4 w-4 shrink-0', isOpen ? 'text-red-400' : 'text-slate-500')} />
        )}
        <div className="min-w-0 flex-1">
          <div className={clsx('text-[10px] font-extrabold uppercase tracking-widest', isOpen ? 'text-red-300' : 'text-slate-500')}>
            {isOpen ? t.dispatch.redAlert : a.status === 'executed' ? t.dispatch.executed : t.dispatch.dismissed}
          </div>
          <p className="mt-0.5 text-sm font-semibold leading-snug text-white">{title}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {timeAgo(a.createdAt, t.common)}
            {a.sosIds.length > 0 && ` · ${a.sosIds.length} SOS`}
            {a.decidedBy && ` · ${t.dispatch.by}: ${a.decidedBy}`}
          </p>
        </div>
      </button>

      <div className="mt-2.5 space-y-1.5 rounded-lg bg-black/25 p-2.5 text-xs">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.dispatch.recommendation}</div>
        <div className="flex items-center gap-2 text-slate-200">
          <Ambulance className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="text-slate-400">{priority ? t.dispatch.accessibleTransport : t.dispatch.sendBrigade}:</span>
          <b className="truncate">{brigade?.name ?? t.common.none}</b>
        </div>
        {!priority && (
          <div className="flex items-center gap-2 text-slate-200">
            <MapPinPlus className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span className="text-slate-400">{t.dispatch.openPoint}:</span>
            <b className="truncate">{newPoint?.name.replace(/\s*\(.*\)$/, '') ?? t.common.none}</b>
          </div>
        )}
      </div>

      {isOpen && (
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={() => run('exec')}
            disabled={!!busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500 py-2 text-xs font-bold text-white shadow-lg shadow-red-500/30 transition hover:bg-red-400 disabled:opacity-60"
          >
            {busy === 'exec' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {t.dispatch.confirm}
          </button>
          <button onClick={() => run('dismiss')} disabled={!!busy} className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-60">
            <XCircle className="h-3.5 w-3.5" /> {t.dispatch.dismiss}
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-[11px] text-red-300">{t.common.errorGeneric}: {err}</p>}
    </article>
  );
}
