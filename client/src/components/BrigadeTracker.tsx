import { useState } from 'react';
import clsx from 'clsx';
import { Ambulance, CheckCircle2, Hospital, Loader2, Warehouse } from 'lucide-react';
import type { Brigade, SosSignal } from '@shared/types';
import { useI18n } from '../i18n';
import { api, ApiError } from '../lib/api';
import { ARRIVAL_RADIUS_M, distanceM, fmtDistance } from '../lib/format';

/** The brigade serving (or, after the job, last served) this SOS — if the citizen should still see it. */
export function brigadeFor(sos: SosSignal, brigades: Record<string, Brigade>): Brigade | undefined {
  const b = sos.brigadeId ? brigades[sos.brigadeId] : undefined;
  if (!b) return undefined;
  if (b.targetSosIds.includes(sos.id) && sos.status === 'assigned') return b;
  if (b.status === 'returning' && b.followSosIds?.includes(sos.id)) return b;
  return undefined;
}

/**
 * Live status of the brigade for one SOS:
 *  1. en route / on scene → distance, ETA and the "Briqada çatdı" button (unlocks ≤ 100 m,
 *     the server validates the same rule);
 *  2. after the job → where the unit is going next (nearest hospital or base).
 */
export function BrigadeTracker({ sos, brigade, token, compact, onError }: { sos: SosSignal; brigade?: Brigade; token: string | null; compact?: boolean; onError: (msg: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  if (!brigade) return null;

  const returning = brigade.status === 'returning';
  const d = distanceM(brigade.location, returning && brigade.target ? brigade.target : sos.location);
  const near = !returning && distanceM(brigade.location, sos.location) <= ARRIVAL_RADIUS_M;
  const confirmed = !!sos.confirmedAt;
  const unit = brigade.name.split(' · ')[0];

  const confirm = async () => {
    setBusy(true);
    try {
      await api(`/citizen/sos/${sos.id}/arrived`, { method: 'POST', token });
    } catch (e) {
      onError(e instanceof ApiError && e.code === 'BRIGADE_TOO_FAR' ? t.citizen.brigadeTooFar : t.common.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  const title = returning
    ? brigade.destinationKind === 'hospital'
      ? t.citizen.brigadeToHospital
      : t.citizen.brigadeToBase
    : brigade.status === 'on_scene' || near
      ? t.citizen.brigadeOnScene
      : t.citizen.brigadeOnWay;

  return (
    <div className={clsx('rounded-xl border p-2.5', !compact && 'mt-2', returning ? 'border-sky-200 bg-sky-50' : 'border-amber-200 bg-amber-50/80')}>
      <div className="flex items-center gap-2 text-xs">
        <span className={`brigade-pin brigade-${brigade.type} !h-6 !w-6 shrink-0 !text-[10px]`}>{{ fire: 'Y', medical: 'T', rescue: 'X' }[brigade.type]}</span>
        <div className="min-w-0 flex-1">
          <div className={clsx('truncate font-semibold', returning ? 'text-sky-900' : 'text-amber-900')}>
            {title} · {unit}
          </div>
          <div className={clsx('truncate text-[11px]', returning ? 'text-sky-800/80' : 'text-amber-800/80')}>
            {returning && brigade.destinationName ? `${brigade.destinationName} · ` : ''}
            {fmtDistance(d, t.common)} {t.citizen.away}
            {!near && brigade.etaS ? ` · ETA ${Math.max(1, Math.ceil(brigade.etaS / 60))} ${t.common.minutes}` : ''}
          </div>
        </div>
        {returning ? (
          brigade.destinationKind === 'hospital' ? <Hospital className="h-4 w-4 shrink-0 text-sky-700" /> : <Warehouse className="h-4 w-4 shrink-0 text-sky-700" />
        ) : (
          <Ambulance className={clsx('h-4 w-4 shrink-0 text-amber-700', !near && 'animate-pulse')} />
        )}
      </div>

      {confirmed ? (
        <div className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-100 py-1.5 text-xs font-bold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {returning ? t.citizen.sosDone : t.citizen.brigadeConfirmed}
        </div>
      ) : returning ? null : (
        <>
          <button
            onClick={confirm}
            disabled={!near || busy}
            aria-disabled={!near}
            className={clsx(
              'mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-extrabold transition',
              near ? 'animate-pulseRing bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-700' : 'cursor-not-allowed bg-slate-200 text-slate-400',
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t.citizen.brigadeArrived}
          </button>
          {!near && <p className="mt-1 text-center text-[10px] text-amber-800/70">{t.citizen.brigadeArrivedHint}</p>}
        </>
      )}
    </div>
  );
}
