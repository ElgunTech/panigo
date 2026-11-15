import clsx from 'clsx';
import { Building2, Flame, HeartPulse, ShieldCheck, Trees, Trophy, Waves } from 'lucide-react';
import type { AssemblyPointType, Hazard } from '@shared/types';
import { LANGS, useI18n, type Lang } from '../i18n';
import { occColor } from '../lib/format';
import type { ConnState } from '../lib/useLive';

export function HazardIcon({ hazard, className }: { hazard: Hazard; className?: string }) {
  const I = { fire: Flame, collapse: Building2, flood: Waves, medical: HeartPulse }[hazard];
  return <I className={className} aria-hidden />;
}

export function PointIcon({ type, className }: { type: AssemblyPointType; className?: string }) {
  const I = { shelter: ShieldCheck, park: Trees, stadium: Trophy }[type];
  return <I className={className} aria-hidden />;
}

export function OccupancyBar({ value, dark, className }: { value: number; dark?: boolean; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className={clsx('h-1.5 w-full overflow-hidden rounded-full', dark ? 'bg-white/10' : 'bg-slate-200', className)}
      role="meter"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${v}%`, background: occColor(v) }} />
    </div>
  );
}

export function LangSwitch({ dark }: { dark?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={clsx('flex rounded-lg p-0.5 text-xs font-semibold', dark ? 'bg-white/5' : 'bg-slate-100')} role="group" aria-label={t.common.language}>
      {(Object.keys(LANGS) as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={clsx(
            'rounded-md px-2 py-1 transition',
            lang === l ? (dark ? 'bg-white/15 text-white' : 'bg-white text-slate-900 shadow-sm') : dark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900',
          )}
        >
          {LANGS[l].label}
        </button>
      ))}
    </div>
  );
}

export function ConnBadge({ conn, dark }: { conn: ConnState; dark?: boolean }) {
  const { t } = useI18n();
  const label = conn === 'live' ? t.common.live : conn === 'connecting' ? t.common.reconnecting : t.common.offline;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', dark ? 'bg-white/5 text-slate-300' : 'bg-slate-100 text-slate-600')}>
      <span className={clsx('h-2 w-2 rounded-full', conn === 'live' ? 'bg-emerald-500' : conn === 'connecting' ? 'animate-pulse bg-amber-400' : 'bg-red-500')} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-red-500 to-rose-700 shadow-lg shadow-red-500/20">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3 21.5 19.5h-19Z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="17" r=".6" fill="white" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className={clsx('text-sm font-extrabold tracking-tight', dark ? 'text-white' : 'text-slate-900')}>UCE</div>
        <div className={clsx('text-[10px] font-medium uppercase tracking-[0.14em]', dark ? 'text-slate-400' : 'text-slate-500')}>Crisis Engine</div>
      </div>
    </div>
  );
}
