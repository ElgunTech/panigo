import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Activity, Ambulance, Building, MapPinOff, Play, Power, RefreshCcw, ScrollText, SlidersHorizontal, Trash2, Zap } from 'lucide-react';
import type { AssemblyPoint, LatLng } from '@shared/types';
import { useI18n } from '../../i18n';
import type { LiveState } from '../../lib/liveState';
import { api } from '../../lib/api';
import { occColor, pct, timeAgo } from '../../lib/format';
import { OccupancyBar, PointIcon } from '../../components/ui';
import type { Ops } from '../Dispatch';

type Tab = 'points' | 'brigades' | 'control' | 'audit';

export function SidePanel({ state, ops, role, onClosureMode, onFocus }: { state: LiveState; ops: Ops; role: string; onClosureMode: () => void; onFocus: (p: LatLng) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('points');
  const tabs: { id: Tab; label: string; icon: typeof Building }[] = [
    { id: 'points', label: t.dispatch.points, icon: Building },
    { id: 'brigades', label: t.dispatch.brigades, icon: Ambulance },
    { id: 'control', label: t.dispatch.control, icon: SlidersHorizontal },
    { id: 'audit', label: t.dispatch.audit, icon: ScrollText },
  ];
  return (
    <>
      <nav className="grid grid-cols-4 border-b border-white/5 bg-ink-900" role="tablist">
        {tabs.map(({ id, label, icon: I }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={clsx('flex flex-col items-center gap-1 border-b-2 py-2 text-[10px] font-semibold uppercase tracking-wider transition', tab === id ? 'border-red-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300')}
          >
            <I className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'points' && <PointsTab state={state} ops={ops} onFocus={onFocus} />}
        {tab === 'brigades' && <BrigadesTab state={state} onFocus={onFocus} />}
        {tab === 'control' && <ControlTab state={state} ops={ops} role={role} onClosureMode={onClosureMode} />}
        {tab === 'audit' && <AuditTab ops={ops} />}
      </div>
    </>
  );
}

function PointsTab({ state, ops, onFocus }: { state: LiveState; ops: Ops; onFocus: (p: LatLng) => void }) {
  const points = Object.values(state.points).sort((a, b) => (a.status === 'reserve' ? 1 : 0) - (b.status === 'reserve' ? 1 : 0) || pct(b) - pct(a));
  return (
    <ul className="space-y-2">
      {points.map((p) => (
        <PointRow key={p.id} p={p} ops={ops} onFocus={onFocus} />
      ))}
    </ul>
  );
}

function PointRow({ p, ops, onFocus }: { p: AssemblyPoint; ops: Ops; onFocus: (p: LatLng) => void }) {
  const { t } = useI18n();
  const v = pct(p);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? v;
  return (
    <li className={clsx('rounded-xl border p-2.5', v > 95 && p.status === 'open' ? 'border-red-500/50 bg-red-950/30' : 'border-white/5 bg-ink-850')}>
      <div className="flex items-center gap-2">
        <button onClick={() => onFocus(p.location)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/5 text-slate-300" aria-label="focus">
          <PointIcon type={p.type} className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-white">{p.name}</div>
          <div className="text-[10px] text-slate-500">
            {t.pointStatus[p.status]} · {p.occupancy.toLocaleString()}/{p.capacity.toLocaleString()}
            {p.incoming > 0 && ` · +${p.incoming} →`}
          </div>
        </div>
        <span className="font-mono text-xs font-semibold" style={{ color: p.status === 'open' ? occColor(shown) : '#64748b' }}>
          {shown.toFixed(0)}%
        </span>
      </div>
      {p.status === 'open' ? (
        <>
          <OccupancyBar value={shown} dark className="mt-2" />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(shown)}
            aria-label={t.dispatch.setOccupancy}
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={() => draft !== null && ops.setPoint(p.id, { occupancyPct: draft }).finally(() => setDraft(null))}
            onKeyUp={() => draft !== null && ops.setPoint(p.id, { occupancyPct: draft }).finally(() => setDraft(null))}
            className="occ-range mt-1.5 w-full"
          />
          <div className="mt-1 flex justify-end">
            <button onClick={() => ops.setPoint(p.id, { status: 'closed' })} className="text-[10px] font-semibold text-slate-500 hover:text-red-400">
              {t.common.close}
            </button>
          </div>
        </>
      ) : (
        <button onClick={() => ops.setPoint(p.id, { status: 'open' })} className="mt-2 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20">
          {t.common.open}
        </button>
      )}
    </li>
  );
}

function BrigadesTab({ state, onFocus }: { state: LiveState; onFocus: (p: LatLng) => void }) {
  const { t } = useI18n();
  const tone = { available: 'bg-emerald-500/15 text-emerald-300', en_route: 'bg-amber-500/15 text-amber-300', on_scene: 'bg-violet-500/15 text-violet-300', offline: 'bg-slate-500/15 text-slate-400' };
  return (
    <ul className="space-y-2">
      {Object.values(state.brigades).map((b) => (
        <li key={b.id}>
          <button onClick={() => onFocus(b.location)} className="flex w-full items-center gap-2.5 rounded-xl border border-white/5 bg-ink-850 p-2.5 text-left hover:border-white/10">
            <span className={`brigade-pin brigade-${b.type} !h-7 !w-7 shrink-0`}>{{ fire: 'Y', medical: 'T', rescue: 'X' }[b.type]}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">{b.name}</div>
              <div className="text-[10px] text-slate-500">
                {t.brigadeType[b.type]}
                {b.targetSosIds.length > 0 && ` · ${b.targetSosIds.length} ${t.dispatch.targets}`}
                {b.status === 'en_route' && b.etaS !== undefined && ` · ${t.dispatch.eta} ${Math.max(1, Math.ceil(b.etaS / 60))} ${t.common.minutes}`}
              </div>
            </div>
            <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold', tone[b.status])}>{t.brigadeStatus[b.status]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ControlTab({ state, ops, role, onClosureMode }: { state: LiveState; ops: Ops; role: string; onClosureMode: () => void }) {
  const { t } = useI18n();
  const [presets, setPresets] = useState<{ name: string; location: LatLng; radiusM: number }[]>([]);
  useEffect(() => {
    api<{ closurePresets: typeof presets }>('/meta')
      .then((m) => setPresets(m.closurePresets))
      .catch(() => undefined);
  }, []);
  const closures = Object.values(state.closures);
  const osrm = state.system?.providers.find((p) => p.id === 'osrm');
  const running = state.system?.scenarioRunning;

  return (
    <div className="space-y-3">
      <Card title={t.dispatch.scenario} icon={<Activity className="h-3.5 w-3.5 text-red-400" />}>
        <p className="text-[11px] text-slate-400">{t.dispatch.scenarioDesc}</p>
        <button
          onClick={() => ops.scenario().catch(() => undefined)}
          disabled={running}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-500 py-2 text-xs font-bold text-white hover:bg-red-400 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" /> {running ? t.dispatch.scenarioRunning : t.dispatch.runScenario}
        </button>
      </Card>

      <Card title={t.dispatch.addClosure} icon={<MapPinOff className="h-3.5 w-3.5 text-red-400" />}>
        <button onClick={onClosureMode} className="w-full rounded-lg border border-red-500/40 bg-red-500/10 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20">
          {t.dispatch.addClosureHint}
        </button>
        <div className="mt-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.dispatch.closurePresets}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p.name} onClick={() => ops.addClosure(p.name, p.location, p.radiusM, 'Dağıntı').catch(() => undefined)} className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">
              {p.name}
            </button>
          ))}
        </div>
        {closures.length > 0 && (
          <>
            <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.dispatch.activeClosures}</div>
            <ul className="mt-1.5 space-y-1">
              {closures.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
                  <span className="min-w-0 flex-1 truncate">⛔ {c.name}</span>
                  <button onClick={() => ops.removeClosure(c.id).catch(() => undefined)} className="font-semibold text-emerald-300 hover:underline">
                    {t.dispatch.reopen}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title={t.dispatch.resilience} icon={<Zap className="h-3.5 w-3.5 text-violet-400" />}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-white">{t.dispatch.outage}</div>
            <p className="text-[11px] text-slate-400">{t.dispatch.outageDesc}</p>
          </div>
          <button
            role="switch"
            aria-checked={!!osrm?.forcedDown}
            onClick={() => ops.outage('osrm', !osrm?.forcedDown).catch(() => undefined)}
            className={clsx('relative h-6 w-11 shrink-0 rounded-full transition', osrm?.forcedDown ? 'bg-violet-500' : 'bg-white/15')}
          >
            <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', osrm?.forcedDown ? 'left-[22px]' : 'left-0.5')} />
          </button>
        </div>
        <ul className="mt-2.5 space-y-1">
          {state.system?.providers.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-[11px]">
              <Power className={clsx('h-3 w-3', p.forcedDown || p.state === 'open' ? 'text-red-400' : p.state === 'half_open' ? 'text-amber-400' : 'text-emerald-400')} />
              <span className="font-mono text-slate-300">{p.id}</span>
              <span className="text-slate-500">{p.forcedDown ? t.dispatch.providerState.open : t.dispatch.providerState[p.state]}</span>
              {p.lastError && <span className="truncate text-slate-600">· {p.lastError}</span>}
            </li>
          ))}
        </ul>
      </Card>

      {role === 'admin' && (
        <button onClick={() => confirm(t.dispatch.reset + '?') && ops.reset()} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs font-semibold text-slate-400 hover:bg-white/5">
          <RefreshCcw className="h-3.5 w-3.5" /> {t.dispatch.reset}
        </button>
      )}
    </div>
  );
}

function AuditTab({ ops }: { ops: Ops }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Awaited<ReturnType<Ops['audit']>>>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      ops
        .audit()
        .then((r) => alive && setRows(r))
        .catch(() => undefined);
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ops]);
  return (
    <ul className="space-y-1 font-mono text-[10.5px]">
      {rows.map((r, i) => (
        <li key={i} className="rounded-md bg-ink-850 px-2 py-1.5">
          <span className="text-slate-500">{timeAgo(r.at, t.common)}</span> <span className="text-sky-300">{r.actor}</span> <span className="text-white">{r.action}</span>
          {r.details && <div className="truncate text-slate-500">{JSON.stringify(r.details)}</div>}
        </li>
      ))}
      {!rows.length && (
        <li className="text-slate-500">
          <Trash2 className="inline h-3 w-3" /> —
        </li>
      )}
    </ul>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/5 bg-ink-850 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}
