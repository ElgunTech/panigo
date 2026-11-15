import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { HeartPulse, WifiOff, Accessibility, DoorOpen, LogIn, LogOut, AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock, Crosshair, Footprints, Car, Info, Loader2, MapPin, Navigation, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { HAZARDS, type EvacuationPlan, type Hazard, type LatLng, type PublicSnapshot, type RouteResult, type SosSignal, type Brigade } from '@shared/types';
import { useI18n } from '../i18n';
import { api, ApiError, ensureCitizenToken } from '../lib/api';
import { useLive } from '../lib/useLive';
import { isCitizenRole, setSession, tokenRole, useSession } from '../lib/session';
import { fmtDistance, fmtMinutes, HAZARD_COLOR, occColor, pct, timeAgo } from '../lib/format';
import { BarriersLayer, BrigadesLayer, CityMap, ClosuresLayer, DestinationMarker, EntrancesLayer, MySosLayer, FitTo, MapClick, PointsLayer, RouteLayer, YouMarker } from '../components/CityMap';
import { BrigadeTracker, brigadeFor } from '../components/BrigadeTracker';
import { PulseMeter } from '../components/PulseMeter';
import { ConnBadge, HazardIcon, LangSwitch, Logo, OccupancyBar, PointIcon } from '../components/ui';

const DEFAULT_LOC: LatLng = { lat: 40.3889, lng: 49.8413 };

export default function Citizen() {
  const { t, fmt } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [location, setLocation] = useState<LatLng>(DEFAULT_LOC);
  const [zoneId, setZoneId] = useState('nasimi');
  const [planning, setPlanning] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [safe, setSafe] = useState(false);
  const [sending, setSending] = useState<Hazard | null>(null);
  const [previous, setPrevious] = useState<RouteResult | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState<number>(0);
  const [pulseOpen, setPulseOpen] = useState(false);
  const lastPlan = useRef<EvacuationPlan | null>(null);

  const [params] = useSearchParams();
  const session = useSession();
  const registered = !!session && !session.user.guest && isCitizenRole(session.user.role);
  const care = tokenRole(token) === 'mobility_impaired';

  useEffect(() => {
    // /citizen?care=1 → guest special-care session (from the login page)
    ensureCitizenToken(params.get('care') === '1' && !registered ? true : undefined)
      .then(setToken)
      .catch(() => setToast({ kind: 'err', text: t.common.offline }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Guests can switch special-care mode themselves; registered users' role is managed by admin. */
  const toggleCare = async () => {
    if (registered) return;
    try {
      setState((s) => ({ ...s, plan: null }));
      setToken(await ensureCitizenToken(!care));
    } catch {
      setToast({ kind: 'err', text: t.common.offline });
    }
  };

  const loadSnapshot = useCallback(async () => {
    const [snap, me] = await Promise.all([api<PublicSnapshot>('/public/snapshot'), api<{ sos: SosSignal[]; brigades: Brigade[]; status: { safe: boolean } | null }>('/citizen/me', { token })]);
    if (me.status) setSafe(me.status.safe);
    return { ...snap, sos: me.sos, brigades: me.brigades };
  }, [token]);
  const { state, setState, conn } = useLive(token, loadSnapshot);
  const plan = state.plan;

  // Track previous route to visualise automatic re-routing
  useEffect(() => {
    if (plan && lastPlan.current && plan.reason !== 'initial' && plan.reason !== 'manual' && plan.createdAt !== lastPlan.current.createdAt) {
      setPrevious(lastPlan.current.route);
    }
    if (plan && (plan.reason === 'initial' || plan.reason === 'manual')) setPrevious(null);
    lastPlan.current = plan;
  }, [plan]);

  const requestPlan = useCallback(
    async (loc: LatLng, pointId?: string) => {
      if (!token) return;
      setPlanning(true);
      try {
        const p = await api<EvacuationPlan>('/citizen/plan', { body: { location: loc, pointId }, token });
        setState((s) => ({ ...s, plan: p }));
      } catch {
        setToast({ kind: 'err', text: t.common.offline });
      } finally {
        setPlanning(false);
      }
    },
    [token, setState, t],
  );

  useEffect(() => {
    if (token && !safe) requestPlan(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, location]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const sendSos = async (hazard: Hazard) => {
    if (!token || sending) return;
    setSending(hazard);
    try {
      await api<SosSignal>('/citizen/sos', { body: { hazard, location }, token });
      setSafe(false);
      setToast({ kind: 'ok', text: `${t.citizen.sosSent}: ${t.hazard[hazard]}` });
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof ApiError && e.status === 429 ? t.citizen.sosLimit : t.common.offline });
    } finally {
      setSending(null);
    }
  };

  const cancelSos = async (id: string) => {
    if (!token) return;
    await api(`/citizen/sos/${id}/cancel`, { method: 'POST', token }).catch(() => undefined);
  };

  const toggleSafe = async () => {
    if (!token) return;
    const next = !safe;
    try {
      await api('/citizen/status', { body: { safe: next, location }, token });
      setSafe(next);
      if (next) {
        setState((s) => ({ ...s, plan: null }));
        setToast({ kind: 'ok', text: t.citizen.safeDone });
      } else requestPlan(location);
    } catch {
      setToast({ kind: 'err', text: t.common.offline });
    }
  };

  const useGps = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (p.lat < 40.3 || p.lat > 40.5 || p.lng < 49.7 || p.lng > 50.1) {
          setToast({ kind: 'info', text: t.citizen.gpsOutside });
          return;
        }
        setLocation(p);
      },
      () => setToast({ kind: 'err', text: t.citizen.gpsUnavailable }),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const points = useMemo(() => Object.values(state.points), [state.points]);
  const closures = useMemo(() => Object.values(state.closures), [state.closures]);
  const mySos = useMemo(() => Object.values(state.sos).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5), [state.sos]);
  /** Open signals (pin on the map) and the brigades currently serving them (live marker + route). */
  // SOS pins stay on the map while open, and also after the job while the brigade that
  // served it is still visible (on its way to the hospital / base) or the citizen confirmed it.
  const activeSos = useMemo(
    () => mySos.filter((s) => s.status === 'new' || s.status === 'assigned' || !!s.confirmedAt || !!brigadeFor(s, state.brigades)),
    [mySos, state.brigades],
  );
  const servingBrigades = useMemo(() => {
    const m = new Map<string, Brigade>();
    for (const s of activeSos) {
      const b = brigadeFor(s, state.brigades);
      if (b) m.set(b.id, b);
    }
    return [...m.values()];
  }, [activeSos, state.brigades]);
  /** Offline / backup routing mode: server reports it, or our current route came from the local backup. */
  const offlineMode = state.system?.routingMode === 'offline' || !!plan?.route?.offline;
  // API recovered → replace the backup route with a live one automatically
  const routingMode = state.system?.routingMode;
  useEffect(() => {
    if (routingMode === 'online' && plan?.route?.offline && !safe) requestPlan(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routingMode]);
  const trackedSos = activeSos.find((s) => !!brigadeFor(s, state.brigades));
  const dest = plan?.destination ? (state.points[plan.destination.id] ?? plan.destination) : null;
  const destPct = dest ? pct(dest) : 0;
  const showBanner = plan && plan.reason !== 'initial' && plan.reason !== 'manual' && bannerDismissed !== plan.createdAt;
  const prevPoint = plan?.previousPointId ? state.points[plan.previousPointId] : undefined;
  const fitPoints = useMemo(() => (plan?.route ? [location, ...(dest ? [dest.location] : [])] : [location]), [plan?.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col bg-slate-50 lg:flex-row">
      {/* Panel */}
      <aside className="order-2 flex min-h-0 flex-1 flex-col lg:order-1 lg:w-[420px] lg:flex-none lg:border-r lg:border-slate-200">
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <Link to="/" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label={t.common.back}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <Logo />
          </div>
          <div className="flex items-center gap-2">
            <ConnBadge conn={conn} />
            <LangSwitch />
            <AccountButton />
          </div>
        </header>

        <div className={clsx('scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4 lg:pb-4', trackedSos ? 'pb-80' : 'pb-52')}>
          {/* Location */}
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <MapPin className="h-3.5 w-3.5" /> {t.citizen.yourLocation}
            </label>
            <div className="flex gap-2">
              <select
                value={zoneId}
                onChange={(e) => {
                  setZoneId(e.target.value);
                  const z = state.zones.find((z) => z.id === e.target.value);
                  if (z) setLocation(z.center);
                }}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                aria-label={t.citizen.chooseDistrict}
              >
                <option value="" disabled>
                  {t.citizen.chooseDistrict}
                </option>
                {state.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <button onClick={useGps} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <Crosshair className="h-4 w-4" /> {t.citizen.useGps}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {t.citizen.pickOnMap} · {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
            </p>
          </section>

          {/* Challenge Drop 2 — external routing API down → local backup */}
          {offlineMode && (
            <section role="status" aria-live="polite" className="animate-slideIn flex gap-3 rounded-2xl border border-violet-300 bg-violet-50 p-3 text-violet-900">
              <WifiOff className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 text-sm">
                <p className="font-bold">{t.citizen.offlineTitle}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-violet-800/80">{t.citizen.offlineDesc}</p>
                {plan?.route?.offline && (
                  <p className="mt-1 text-[11px] font-semibold text-violet-700">
                    {t.citizen.offlineSource}: {t.provider[plan.route.provider]}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Challenge Drop 1 — special-care (reduced mobility) mode */}
          <section className={clsx('rounded-2xl border p-3', care ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white shadow-sm')}>
            <div className="flex items-start gap-3">
              <div className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', care ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500')}>
                <Accessibility className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className={clsx('text-sm font-bold', care ? 'text-violet-900' : 'text-slate-800')}>{care ? t.citizen.careModeOn : t.citizen.careMode}</div>
                <p className={clsx('mt-0.5 text-[11px] leading-snug', care ? 'text-violet-800/80' : 'text-slate-500')}>{t.citizen.careModeDesc}</p>
                {registered ? (
                  !care && <p className="mt-1.5 text-[11px] text-slate-400">{t.citizen.careAdminOnly}</p>
                ) : (
                  <button
                    onClick={toggleCare}
                    role="switch"
                    aria-checked={care}
                    className={clsx(
                      'mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                      care ? 'border border-violet-300 bg-white text-violet-700 hover:bg-violet-100' : 'bg-violet-600 text-white hover:bg-violet-700',
                    )}
                  >
                    {care ? t.citizen.careDisable : t.citizen.careEnable}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Re-route banner */}
          {showBanner && plan && (
            <div role="alert" className="animate-slideIn flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <RotateCcw className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{fmt(t.citizen.reroute[plan.reason as 'road_closed'], { pct: prevPoint ? Math.round(pct(prevPoint)) : 90 })}</p>
                {prevPoint && (
                  <p className="mt-0.5 text-amber-800/80">
                    {t.citizen.previous}: <s>{prevPoint.name}</s> → <b>{dest?.name}</b>
                  </p>
                )}
              </div>
              <button onClick={() => setBannerDismissed(plan.createdAt)} className="self-start rounded p-0.5 hover:bg-amber-100" aria-label={t.common.close}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Recommended point */}
          {safe ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-5 w-5" /> {t.citizen.safeDone}
              </div>
            </section>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.citizen.recommended}</span>
                {planning && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              </div>
              {dest && plan?.route ? (
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: occColor(destPct) }}>
                      <PointIcon type={dest.type} className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-bold">{dest.name}</h2>
                      <p className="text-xs text-slate-500">
                        {t.pointType[dest.type]} · {dest.capacity.toLocaleString()} {t.common.people}
                        {dest.accessible && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-violet-100 px-1 py-px text-[10px] font-semibold text-violet-700">
                            <Accessibility className="h-2.5 w-2.5" /> {t.citizen.accessiblePoint}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  {plan.profile === 'accessible' && (
                    <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-2.5 text-[11px] text-violet-900">
                      <div className="flex items-center gap-1.5 font-bold">
                        <Accessibility className="h-3.5 w-3.5" /> {t.citizen.accessibleRoute}
                      </div>
                      <p className="mt-0.5 text-violet-800/80">{t.citizen.accessibleRouteDesc}</p>
                      <p className={clsx('mt-1 font-semibold', plan.route.barriersNear ? 'text-amber-700' : 'text-emerald-700')}>
                        {plan.route.barriersNear ? fmt(t.citizen.barriersNear, { n: plan.route.barriersNear }) : `✓ ${t.citizen.stepFree}`}
                      </p>
                    </div>
                  )}
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <Stat
                      icon={plan.profile === 'accessible' ? <Accessibility className="h-4 w-4" /> : <Footprints className="h-4 w-4" />}
                      value={`${fmtMinutes(plan.route.walkS)} ${t.common.minutes}`}
                      label={plan.profile === 'accessible' ? t.citizen.wheelchair : t.citizen.walk}
                    />
                    <Stat icon={<Navigation className="h-4 w-4" />} value={fmtDistance(plan.route.distanceM, t.common)} label="" />
                    {plan.entrance ? (
                      <Stat icon={<DoorOpen className="h-4 w-4" />} value={plan.entrance.label.replace(/^s*Çıxışs*/i, '#')} label={t.citizen.entrance} />
                    ) : (
                      <Stat icon={<Car className="h-4 w-4" />} value={`${fmtMinutes(plan.route.durationS)} ${t.common.minutes}`} label={plan.profile === 'accessible' ? t.citizen.medicalTransport : t.citizen.drive} />
                    )}
                  </div>
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium text-slate-600">{t.citizen.occupancy}</span>
                      <span className="font-mono font-semibold" style={{ color: occColor(destPct) }}>
                        {destPct.toFixed(0)}% · {dest.occupancy.toLocaleString()}/{dest.capacity.toLocaleString()}
                      </span>
                    </div>
                    <OccupancyBar value={destPct} />
                  </div>
                  <div className={clsx('mt-3 flex items-center gap-1.5 text-[11px]', plan.route.degraded ? 'text-violet-700' : 'text-slate-400')}>
                    <Info className="h-3.5 w-3.5" />
                    {plan.route.offline ? `${t.citizen.offlinePill}: ${t.provider[plan.route.provider]}` : plan.route.mode === 'foot' && plan.profile === 'standard' ? t.citizen.walkRoute : t.provider[plan.route.provider]}
                    {closures.length > 0 && ` · ${closures.length} ${t.citizen.closures}`}
                  </div>
                  {plan.options.every((o) => o.full) && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{t.citizen.allFull}</p>}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t.citizen.noRoute}
                </div>
              )}
            </section>
          )}

          {/* SOS */}
          {/* Desktop: SOS in the panel. Mobile: buttons live in the sticky bottom bar; only my signals stay here. */}
          <section className={clsx('rounded-2xl border border-red-200 bg-white p-4 shadow-sm', mySos.length === 0 && 'hidden lg:block')}>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              <h3 className="text-sm font-bold uppercase tracking-wide text-red-600">{t.citizen.sosTitle}</h3>
            </div>
            <p className="mt-1 hidden text-xs text-slate-500 lg:block">{t.citizen.sosHint}</p>
            {care && <p className="mt-1 hidden text-xs font-semibold text-violet-700 lg:block">♿ {t.citizen.priorityHint}</p>}
            <div className="mt-3 hidden grid-cols-2 gap-2 lg:grid">
              {HAZARDS.map((h) => (
                <button
                  key={h}
                  onClick={() => sendSos(h)}
                  disabled={!!sending || !token}
                  className="group flex items-center gap-2.5 rounded-xl px-3 py-3.5 text-left text-sm font-bold text-white shadow-sm transition active:scale-[0.97] disabled:opacity-60"
                  style={{ background: HAZARD_COLOR[h] }}
                >
                  {sending === h ? <Loader2 className="h-5 w-5 animate-spin" /> : <HazardIcon hazard={h} className="h-5 w-5" />}
                  {t.hazard[h]}
                </button>
              ))}
            </div>
            <button
              onClick={toggleSafe}
              className={clsx(
                'mt-3 hidden w-full items-center justify-center gap-2 rounded-xl py-3.5 lg:flex text-sm font-extrabold tracking-wide transition active:scale-[0.99]',
                safe ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-700',
              )}
            >
              {safe ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
              {safe ? t.citizen.safeUndo : t.citizen.safe}
            </button>
            <button
              onClick={() => setPulseOpen(true)}
              className="mt-2 hidden w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 lg:flex"
            >
              <HeartPulse className="h-4 w-4" /> {t.pulse.open}
              <span className="text-[10px] font-normal text-red-500/80">({t.pulse.camera}, {t.pulse.estimate})</span>
            </button>

            {mySos.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.citizen.mySos}</h4>
                <ul className="space-y-1.5">
                  {mySos.map((s) => (
                    <li key={s.id} className="rounded-xl bg-slate-50 px-2.5 py-2 text-sm">
                      {/* Row 1: hazard + badges (never wrap inside a badge); Row 2: time */}
                      <div className="flex items-center gap-2">
                        <HazardIcon hazard={s.hazard} className="h-4 w-4 shrink-0 text-slate-600" />
                        <span className="min-w-0 truncate font-semibold">{t.hazard[s.hazard]}</span>
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                          {s.priority === 1 && (
                            <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-md bg-violet-600 px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-white" title={t.citizen.priority1}>
                              <Accessibility className="h-3 w-3" />
                              P1
                            </span>
                          )}
                          <span
                            className={clsx(
                              'whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-tight',
                              s.status === 'new' && 'bg-red-100 text-red-700',
                              s.status === 'assigned' && 'bg-amber-100 text-amber-800',
                              s.status === 'resolved' && 'bg-emerald-100 text-emerald-700',
                              s.status === 'cancelled' && 'bg-slate-200 text-slate-600',
                            )}
                          >
                            {t.sosStatus[s.status]}
                          </span>
                          {s.status === 'new' && (
                            <button onClick={() => cancelSos(s.id)} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={t.common.cancel}>
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 pl-6 text-[11px] text-slate-400">
                        <Clock className="h-3 w-3" />
                        {timeAgo(s.createdAt, t.common)}
                        {s.priority === 1 && <span className="text-violet-600">· {t.citizen.priority1}</span>}
                        {s.vitals && (
                          <span className={clsx('ml-1 inline-flex items-center gap-0.5 font-semibold', s.vitals.abnormal ? 'text-red-600' : 'text-rose-500')}>
                            <HeartPulse className="h-3 w-3" />~{s.vitals.bpm} {t.pulse.bpm}
                          </span>
                        )}
                      </div>
                      <BrigadeTracker sos={s} brigade={brigadeFor(s, state.brigades)} token={token} onError={(text) => setToast({ kind: 'err', text })} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Nearby options */}
          {plan && !safe && (
            <section>
              <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.citizen.nearby}</h3>
              <ul className="space-y-2">
                {plan.options.slice(0, 6).map((o) => {
                  const live = state.points[o.point.id] ?? o.point;
                  const v = pct(live);
                  const full = v >= 90;
                  const selected = dest?.id === live.id;
                  return (
                    <li key={live.id}>
                      <button
                        disabled={full || selected}
                        onClick={() => requestPlan(location, live.id)}
                        className={clsx(
                          'flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left transition',
                          selected ? 'border-blue-500 ring-2 ring-blue-500/15' : 'border-slate-200 hover:border-slate-300',
                          full && 'opacity-60',
                        )}
                      >
                        <PointIcon type={live.type} className="h-5 w-5 shrink-0 text-slate-500" />
                        {live.accessible && <Accessibility className="-ml-2 h-3.5 w-3.5 shrink-0 text-violet-600" aria-label={t.citizen.accessiblePoint} />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">{live.name}</span>
                            {full && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">{t.citizen.full}</span>}
                          </div>
                          <OccupancyBar value={v} className="mt-1.5" />
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-xs font-semibold" style={{ color: occColor(v) }}>
                            {v.toFixed(0)}%
                          </div>
                          <div className="text-[11px] text-slate-500">{fmtDistance(o.distanceM, t.common)}</div>
                        </div>
                        {selected && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </aside>

      {/* Map */}
      <div className="relative order-1 h-[34vh] shrink-0 sm:h-[40vh] lg:order-2 lg:h-auto lg:flex-1">
        <CityMap theme="light" className="h-full w-full">
          <MapClick onClick={(p) => setLocation(p)} />
          <ClosuresLayer closures={closures} />
          <RouteLayer route={safe ? null : (plan?.route ?? null)} previous={previous} />
          {!safe && dest?.entrances && <EntrancesLayer entrances={dest.entrances} active={plan?.entrance} label={t.citizen.entrance} />}
          <PointsLayer
            points={points.filter((p) => p.status === 'open' && (!care || p.accessible))}
            highlight={dest?.id}
            onSelect={(p) => pct(p) < 90 && requestPlan(location, p.id)}
            labels={(p) => `${p.name} — ${pct(p).toFixed(0)}%${p.ridershipDaily ? ` · ${p.ridershipDaily.toLocaleString()} ${t.citizen.dailyRiders}` : ''}`}
          />
          <BrigadesLayer brigades={servingBrigades} label={(b) => `${b.name} — ${t.brigadeStatus[b.status]}${b.destinationName ? ` → ${b.destinationName}` : ''}`} />
          {servingBrigades.filter((b) => b.status === 'returning' && b.target).map((b) => (
            <DestinationMarker key={b.id} at={b.target!} kind={b.destinationKind ?? 'base'} label={`${t.citizen.destination}: ${b.destinationName ?? t.citizen.brigadeToBase}`} />
          ))}
          <MySosLayer sos={activeSos} label={(s) => `${t.citizen.sosPoint}: ${t.hazard[s.hazard]} · ${t.sosStatus[s.status]}`} />
          {care && <BarriersLayer barriers={state.barriers} label={t.citizen.barrierTip} />}
          <YouMarker at={location} />
          <FitTo points={fitPoints} deps={plan?.createdAt} />
        </CityMap>
        {offlineMode && (
          <div className="pointer-events-none absolute left-3 top-3 z-[1000] inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg">
            <WifiOff className="h-3.5 w-3.5" /> {t.citizen.offlinePill}
          </div>
        )}
        {toast && (
          <div
            role="status"
            className={clsx(
              'animate-slideIn absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-xl',
              toast.kind === 'ok' && 'bg-emerald-600 text-white',
              toast.kind === 'err' && 'bg-red-600 text-white',
              toast.kind === 'info' && 'bg-slate-900 text-white',
            )}
          >
            {toast.text}
          </div>
        )}
      </div>

      {pulseOpen && <PulseMeter token={token} onClose={() => setPulseOpen(false)} onSent={(bpm) => setToast({ kind: 'ok', text: `${t.pulse.sent}: ~${bpm} ${t.pulse.bpm}` })} />}

      {/* Mobile sticky emergency bar — SOS is always one thumb-tap away */}
      <div className="fixed inset-x-0 bottom-0 z-[1100] border-t border-red-100 bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2.5 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur lg:hidden">
        <div className="mb-2 flex items-center gap-2 px-0.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-red-600">{t.citizen.sosTitle}</span>
          <span className={clsx('ml-auto truncate text-[10px]', care ? 'font-semibold text-violet-600' : 'text-slate-400')}>{care ? '♿ ' + t.citizen.priority1 : t.citizen.sosHintShort}</span>
          <button onClick={() => setPulseOpen(true)} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700" aria-label={t.pulse.open}>
            <HeartPulse className="h-3 w-3" /> {t.pulse.bpm}
          </button>
        </div>
        {trackedSos && (
          <div className="mb-2">
            <BrigadeTracker compact sos={trackedSos} brigade={brigadeFor(trackedSos, state.brigades)} token={token} onError={(text) => setToast({ kind: 'err', text })} />
          </div>
        )}
        <div className="grid grid-cols-4 gap-1.5">
          {HAZARDS.map((h) => (
            <button
              key={h}
              onClick={() => sendSos(h)}
              disabled={!!sending || !token}
              aria-label={`SOS: ${t.hazard[h]}`}
              className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-bold leading-tight text-white shadow-sm transition active:scale-95 disabled:opacity-60"
              style={{ background: HAZARD_COLOR[h] }}
            >
              {sending === h ? <Loader2 className="h-5 w-5 animate-spin" /> : <HazardIcon hazard={h} className="h-5 w-5" />}
              <span className="text-center">{t.hazard[h]}</span>
            </button>
          ))}
        </div>
        <button
          onClick={toggleSafe}
          className={clsx(
            'mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-extrabold tracking-wide transition active:scale-[0.99]',
            safe ? 'border border-slate-300 bg-white text-slate-700' : 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25',
          )}
        >
          {safe ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          {safe ? t.citizen.safeUndo : t.citizen.safe}
        </button>
      </div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2.5">
      <div className="flex items-center justify-center gap-1 text-slate-400">{icon}</div>
      <div className="mt-1 text-sm font-bold">{value}</div>
      {label && <div className="text-[10px] text-slate-500">{label}</div>}
    </div>
  );
}

/** Signed-in citizen → avatar + sign out; guest → "Sign in" link to the unified login page. */
function AccountButton() {
  const { t } = useI18n();
  const session = useSession();
  const user = session && !session.user.guest && isCitizenRole(session.user.role) ? session.user : null;
  if (!user)
    return (
      <Link to="/login?next=/citizen" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
        <LogIn className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t.auth.signIn}</span>
      </Link>
    );
  return (
    <button
      onClick={() => {
        setSession(null);
        window.location.reload();
      }}
      title={`${user.name} — ${t.auth.signOut}`}
      className="group grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-[11px] font-bold uppercase text-white hover:bg-red-600"
    >
      <span className="group-hover:hidden">{user.name.slice(0, 2)}</span>
      <LogOut className="hidden h-3.5 w-3.5 group-hover:block" />
    </button>
  );
}
