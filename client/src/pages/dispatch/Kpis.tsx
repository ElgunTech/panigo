import clsx from 'clsx';
import { Ambulance, Gauge, ShieldCheck, Siren, TriangleAlert, Users } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { LiveState } from '../../lib/liveState';
import { occColor } from '../../lib/format';

export function Kpis({ state, activeSos, openAlerts }: { state: LiveState; activeSos: number; openAlerts: number }) {
  const { t } = useI18n();
  const open = Object.values(state.points).filter((p) => p.status === 'open');
  const occ = open.reduce((s, p) => s + p.occupancy, 0);
  const cap = open.reduce((s, p) => s + p.capacity, 0);
  const avg = cap ? (occ / cap) * 100 : 0;
  const brigades = Object.values(state.brigades);
  const free = brigades.filter((b) => b.status === 'available').length;
  const citizens = Object.values(state.citizens);
  const evacuating = citizens.filter((c) => !c.safe && c.destinationPointId).length;
  const safe = citizens.filter((c) => c.safe).length;

  const items = [
    { icon: Siren, label: t.dispatch.kpi.activeSos, value: activeSos, tone: activeSos ? 'text-red-400' : 'text-white' },
    { icon: TriangleAlert, label: t.dispatch.kpi.alerts, value: openAlerts, tone: openAlerts ? 'text-red-400' : 'text-white', pulse: openAlerts > 0 },
    { icon: Gauge, label: t.dispatch.kpi.avgOcc, value: `${avg.toFixed(0)}%`, color: occColor(avg) },
    { icon: Ambulance, label: t.dispatch.kpi.freeBrigades, value: `${free}/${brigades.length}`, tone: free ? 'text-white' : 'text-amber-400' },
    { icon: Users, label: t.dispatch.kpi.evacuating, value: evacuating, tone: 'text-white' },
    { icon: ShieldCheck, label: t.dispatch.kpi.safe, value: safe, tone: 'text-emerald-400' },
  ];
  return (
    <div className="grid grid-cols-3 gap-px border-b border-white/5 bg-white/5 md:grid-cols-6">
      {items.map(({ icon: I, label, value, tone, color, pulse }) => (
        <div key={label} className={clsx('flex items-center gap-3 bg-ink-900 px-4 py-2.5', pulse && 'bg-red-950/40')}>
          <I className={clsx('h-4 w-4 shrink-0', pulse ? 'animate-pulse text-red-400' : 'text-slate-500')} />
          <div className="min-w-0">
            <div className={clsx('font-mono text-lg font-semibold leading-tight', tone)} style={color ? { color } : undefined}>
              {value}
            </div>
            <div className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
