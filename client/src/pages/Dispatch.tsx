import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, Lock, LogOut, MapPinOff, Server } from 'lucide-react';
import type { DispatchSnapshot, LatLng } from '@shared/types';
import { useI18n } from '../i18n';
import { api, ApiError, getToken, setToken } from '../lib/api';
import { useLive } from '../lib/useLive';
import { pct } from '../lib/format';
import { BrigadesLayer, CityMap, ClosuresLayer, MapClick, PointsLayer, SosLayer } from '../components/CityMap';
import { ConnBadge, LangSwitch, Logo } from '../components/ui';
import { Kpis } from './dispatch/Kpis';
import { AlertsPanel } from './dispatch/AlertsPanel';
import { SosFeed } from './dispatch/SosFeed';
import { SidePanel } from './dispatch/SidePanel';
import { ZonesLayer } from './dispatch/ZonesLayer';

interface User {
  sub: string;
  role: string;
  name: string;
}

export default function Dispatch() {
  const [token, setTok] = useState<string | null>(() => getToken('operator'));
  const [user, setUser] = useState<User | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('uce.user') ?? 'null');
    } catch {
      return null;
    }
  });

  const logout = useCallback(() => {
    setToken('operator', null);
    localStorage.removeItem('uce.user');
    setTok(null);
    setUser(null);
  }, []);

  if (!token || !user)
    return (
      <Login
        onLogin={(tk, u) => {
          setToken('operator', tk);
          localStorage.setItem('uce.user', JSON.stringify(u));
          setTok(tk);
          setUser(u);
        }}
      />
    );
  return <Console token={token} user={user} onLogout={logout} />;
}

export type Ops = ReturnType<typeof makeOps>;
function makeOps(token: string, onAuthError: () => void) {
  const call = async <T,>(path: string, body?: unknown, method?: string) => {
    try {
      return await api<T>(path, { token, body, method });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      throw e;
    }
  };
  return {
    execute: (id: string) => call(`/dispatch/alerts/${id}/execute`, undefined, 'POST'),
    dismiss: (id: string) => call(`/dispatch/alerts/${id}/dismiss`, undefined, 'POST'),
    assign: (brigadeId: string, sosIds: string[]) => call('/dispatch/assign', { brigadeId, sosIds }),
    addClosure: (name: string, location: LatLng, radiusM = 250, reason = 'Operator') => call('/dispatch/closures', { name, location, radiusM, reason }),
    removeClosure: (id: string) => call(`/dispatch/closures/${id}`, undefined, 'DELETE'),
    setPoint: (id: string, patch: { occupancyPct?: number; status?: string }) => call(`/dispatch/points/${id}`, patch, 'PATCH'),
    scenario: () => call('/sim/scenario', {}),
    outage: (provider: string, down: boolean) => call('/sim/outage', { provider, down }),
    reset: () => call('/sim/reset', {}),
    audit: () => call<{ at: number; actor: string; action: string; details?: Record<string, unknown> }[]>('/dispatch/audit'),
  };
}

function Console({ token, user, onLogout }: { token: string; user: User; onLogout: () => void }) {
  const { t } = useI18n();
  const [closureMode, setClosureMode] = useState(false);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const load = useCallback(async () => {
    try {
      return await api<DispatchSnapshot>('/dispatch/snapshot', { token });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) onLogout();
      throw e;
    }
  }, [token, onLogout]);
  const { state, conn } = useLive(token, load);
  const ops = useMemo(() => makeOps(token, onLogout), [token, onLogout]);

  const sos = useMemo(() => Object.values(state.sos).sort((a, b) => b.createdAt - a.createdAt), [state.sos]);
  const activeSos = useMemo(() => sos.filter((s) => s.status === 'new' || s.status === 'assigned'), [sos]);
  const points = useMemo(() => Object.values(state.points), [state.points]);
  const brigades = useMemo(() => Object.values(state.brigades), [state.brigades]);
  const closures = useMemo(() => Object.values(state.closures), [state.closures]);
  const alerts = useMemo(() => Object.values(state.alerts).sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.createdAt - a.createdAt), [state.alerts]);
  const openAlerts = alerts.filter((a) => a.status === 'open').length;
  const degraded = state.system?.providers.some((p) => p.id === 'osrm' && (p.state === 'open' || p.forcedDown));

  return (
    <div className="dark-map flex h-full flex-col bg-ink-950 text-slate-200">
      {/* Top bar */}
      <header className={clsx('flex flex-wrap items-center gap-3 border-b px-4 py-2.5', openAlerts ? 'border-red-500/40 bg-gradient-to-r from-red-950/60 to-ink-900' : 'border-white/5 bg-ink-900')}>
        <Link to="/" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Logo dark />
        <div className="hidden h-6 w-px bg-white/10 md:block" />
        <h1 className="hidden text-sm font-semibold text-slate-300 md:block">{t.landing.dispatchTitle}</h1>
        <div className="ml-auto flex items-center gap-2">
          {state.system && (
            <span className={clsx('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex', degraded ? 'bg-violet-500/15 text-violet-300' : 'bg-white/5 text-slate-300')}>
              <Server className="h-3.5 w-3.5" />
              {state.system.providers.map((p) => `${p.id}:${p.forcedDown ? t.dispatch.providerState.open : t.dispatch.providerState[p.state]}`).join(' · ')}
            </span>
          )}
          <ConnBadge conn={conn} dark />
          <LangSwitch dark />
          <span className="hidden text-xs text-slate-400 lg:inline">
            {user.name} · <span className="uppercase">{user.role}</span>
          </span>
          <button onClick={onLogout} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label={t.common.logout} title={t.common.logout}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <Kpis state={state} activeSos={activeSos.length} openAlerts={openAlerts} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left: alerts + feed */}
        <aside className="scroll-thin order-2 flex max-h-[60vh] min-h-0 flex-col gap-3 overflow-y-auto border-white/5 p-3 lg:order-1 lg:max-h-none lg:w-[360px] lg:border-r">
          <AlertsPanel alerts={alerts} state={state} ops={ops} onFocus={setFocus} />
          <SosFeed sos={sos} brigades={brigades} zones={state.zones} ops={ops} onFocus={setFocus} />
        </aside>

        {/* Map */}
        <div className="relative order-1 h-[45vh] shrink-0 lg:order-2 lg:h-auto lg:flex-1">
          <CityMap theme="dark" className={clsx('h-full w-full', closureMode && 'cursor-crosshair')}>
            <ZonesLayer zones={state.zones} sos={activeSos} alerts={alerts} focus={focus} />
            <ClosuresLayer closures={closures} />
            <PointsLayer points={points} labels={(p) => `${p.name} — ${pct(p).toFixed(0)}% (${t.pointStatus[p.status]})`} />
            <SosLayer sos={sos.slice(0, 600)} label={(s) => `${t.hazard[s.hazard]} · ${t.sosStatus[s.status]}`} />
            <BrigadesLayer brigades={brigades} label={(b) => `${b.name} — ${t.brigadeStatus[b.status]}${b.etaS ? ` · ${t.dispatch.eta} ${Math.ceil(b.etaS / 60)} ${t.common.minutes}` : ''}`} />
            {closureMode && (
              <MapClick
                onClick={(p) => {
                  setClosureMode(false);
                  ops.addClosure(`${t.dispatch.addClosure} #${closures.length + 1}`, p).catch(() => undefined);
                }}
              />
            )}
          </CityMap>
          {closureMode && (
            <div className="absolute left-1/2 top-3 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-xl">
              <MapPinOff className="h-4 w-4" /> {t.dispatch.addClosureHint}
              <button onClick={() => setClosureMode(false)} className="ml-2 rounded bg-white/20 px-2 py-0.5 text-xs">
                {t.common.cancel}
              </button>
            </div>
          )}
          <Legend />
        </div>

        {/* Right: tabs */}
        <aside className="order-3 flex min-h-0 flex-col border-white/5 lg:w-[360px] lg:border-l">
          <SidePanel state={state} ops={ops} role={user.role} onClosureMode={() => setClosureMode(true)} onFocus={setFocus} />
        </aside>
      </div>
    </div>
  );
}

function Legend() {
  const { t } = useI18n();
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[500] hidden rounded-xl border border-white/10 bg-ink-900/90 p-3 text-[11px] text-slate-300 backdrop-blur md:block">
      <div className="mb-1.5 font-semibold text-slate-400">{t.dispatch.points}</div>
      <div className="flex gap-3">
        {[
          ['#22c55e', '<70%'],
          ['#eab308', '70–90%'],
          ['#f97316', '90–95%'],
          ['#dc2626', '>95%'],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-3">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full border border-dashed border-red-500 bg-red-500/30" /> {t.dispatch.activeClosures}
        </span>
        <span className="flex items-center gap-1">
          <span className="grid h-3.5 w-3.5 place-items-center rounded bg-cyan-600 text-[8px] font-bold text-white">X</span> {t.dispatch.brigades}
        </span>
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('dispatcher');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ token: string; user: User }>('/auth/login', { body: { username, password } });
      onLogin(r.token, r.user);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t.dispatch.invalid : err instanceof ApiError && err.status === 429 ? 'Rate limit' : t.common.offline);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-full place-items-center bg-ink-950 px-4">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(239,68,68,0.15),transparent_60%)]" />
      <form onSubmit={submit} className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-ink-850 p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <Logo dark />
          <LangSwitch dark />
        </div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-white">
          <Lock className="h-4 w-4 text-red-400" /> {t.dispatch.loginTitle}
        </h1>
        <label className="mt-5 block text-xs font-medium text-slate-400">
          {t.dispatch.username}
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" className="mt-1.5 w-full rounded-xl border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-red-500/60 focus:ring-2 focus:ring-red-500/20" />
        </label>
        <label className="mt-3 block text-xs font-medium text-slate-400">
          {t.dispatch.password}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="mt-1.5 w-full rounded-xl border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-red-500/60 focus:ring-2 focus:ring-red-500/20" />
        </label>
        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-xl bg-gradient-to-r from-red-500 to-rose-600 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-500/20 transition hover:brightness-110 disabled:opacity-60">
          {t.dispatch.login}
        </button>
        <p className="mt-4 text-center text-[11px] text-slate-500">{t.dispatch.demoHint}</p>
      </form>
    </div>
  );
}
