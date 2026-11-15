import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, LogIn, Radio, Smartphone } from 'lucide-react';
import { useI18n } from '../i18n';
import { LangSwitch, Logo } from '../components/ui';

export default function Landing() {
  const { t } = useI18n();
  return (
    <div className="min-h-full bg-ink-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(239,68,68,0.18),transparent_55%)]" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo dark />
        <div className="flex items-center gap-2">
          <LangSwitch dark />
          <Link to="/login" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/5">
            <LogIn className="h-3.5 w-3.5" /> {t.auth.signIn}
          </Link>
          <Link to="/login?mode=register" className="hidden rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-slate-200 sm:inline-block">
            {t.auth.signUp}
          </Link>
        </div>
      </header>
      <main className="relative mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-16">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-red-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> Digital Challenge Cup · Final
        </p>
        <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight sm:text-5xl">{t.app.title}</h1>
        <p className="mt-4 max-w-2xl text-base text-slate-400 sm:text-lg">{t.app.tagline}</p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <Card to="/citizen" icon={<Smartphone className="h-6 w-6" />} title={t.landing.citizenTitle} desc={t.landing.citizenDesc} cta={t.landing.citizenCta} accent="from-blue-500 to-indigo-600" />
          <Card to="/login?next=/dispatch" icon={<Radio className="h-6 w-6" />} title={t.landing.dispatchTitle} desc={t.landing.dispatchDesc} cta={t.landing.dispatchCta} accent="from-red-500 to-rose-700" />
        </div>

        <ul className="mt-10 grid gap-3 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
          {t.landing.features.map((f) => (
            <li key={f} className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> {f}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function Card({ to, icon, title, desc, cta, accent }: { to: string; icon: React.ReactNode; title: string; desc: string; cta: string; accent: string }) {
  return (
    <Link to={to} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-ink-850 p-6 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-ink-800 sm:p-8">
      <div className={`mb-5 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br ${accent} shadow-lg`}>{icon}</div>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{desc}</p>
      <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-white">
        {cta} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </span>
    </Link>
  );
}
