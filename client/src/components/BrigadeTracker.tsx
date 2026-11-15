import { useState } from 'react';
import clsx from 'clsx';
import { Ambulance, CheckCircle2, Loader2 } from 'lucide-react';
import type { Brigade, SosSignal } from '@shared/types';
import { useI18n } from '../i18n';
import { api, ApiError } from '../lib/api';
import { ARRIVAL_RADIUS_M, distanceM, fmtDistance } from '../lib/format';

/**
 * Live status of the brigade serving one SOS + the "Briqada çatdı" button,
 * which unlocks only when the brigade is within 100 m of the SOS point
 * (the server validates the same rule — the button is just the UI side).
 */
export function BrigadeTracker({ sos, brigade, token, compact, onError }: { sos: SosSignal; brigade?: Brigade; token: string | null; compact?: boolean; onError: (msg: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  if (!brigade || sos.status !== 'assigned') return null;

  const d = distanceM(brigade.location, sos.location);
  const near = d <= ARRIVAL_RADIUS_M;
  const confirmed = !!sos.confirmedAt;
  const onScene = brigade.status === 'on_scene';

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

  return (
    <div className={clsx('rounded-xl border', compact ? 'border-amber-200 bg-amber-50 p-2' : 'mt-2 border-amber-200 bg-amber-50/70 p-2.5')}>
      <div className="flex items-center gap-2 text-xs">
        <span className={`brigade-pin brigade-${brigade.type} !h-6 !w-6 shrink-0 !text-[10px]`}>{{ fire: 'Y', medical: 'T', rescue: 'X' }[brigade.type]}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-amber-900">
            {onScene || near ? t.citizen.brigadeOnScene : t.citizen.brigadeOnWay} · {brigade.name.split(' · ')[0]}
          </div>
          <div className="text-[11px] text-amber-800/80">
            {fmtDistance(d, t.common)} {t.citizen.away}
            {!near && brigade.etaS ? ` · ETA ${Math.max(1, Math.ceil(brigade.etaS / 60))} ${t.common.minutes}` : ''}
          </div>
        </div>
        <Ambulance className={clsx('h-4 w-4 shrink-0 text-amber-700', !near && 'animate-pulse')} />
      </div>
      {confirmed ? (
        <div className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-100 py-2 text-xs font-bold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {t.citizen.brigadeConfirmed}
        </div>
      ) : (
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
