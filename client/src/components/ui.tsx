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

/**
 * PaniGo mark — a safe-place pin with a forward arrow ("go there").
 * Same geometry as /public/logo.svg and /public/favicon.svg.
 */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="PaniGo">
      <defs>
        <linearGradient id="pg-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F43F5E" />
          <stop offset="1" stopColor="#B91C1C" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#pg-bg)" />
      <path d="M32 55C24.5 46.6 16 38.6 16 28.5a16 16 0 0 1 32 0C48 38.6 39.5 46.6 32 55Z" fill="#fff" />
      <path d="M24.5 29h14M33 22.5l6.5 6.5-6.5 6.5" fill="none" stroke="#DC2626" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className="h-9 w-9 shrink-0 drop-shadow-[0_4px_10px_rgba(220,38,38,0.35)]" />
      <div className="leading-tight">
        <div className={clsx('text-[15px] font-extrabold tracking-tight', dark ? 'text-white' : 'text-slate-900')}>
          Pani<span className="text-red-500">Go</span>
        </div>
        <div lang="en" className={clsx('text-[10px] font-medium uppercase tracking-[0.14em]', dark ? 'text-slate-400' : 'text-slate-500')}>Evacuation Engine</div>
      </div>
    </div>
  );
}
