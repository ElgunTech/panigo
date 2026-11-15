import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Accessibility, ArrowLeft, Building2, ChevronRight, Eye, EyeOff, HeartPulse, Loader2, LogIn, Siren, UserPlus } from 'lucide-react';
import { useI18n } from '../i18n';
import { api, ApiError } from '../lib/api';
import { homeFor, isStaff, setSession, useSession, type Session } from '../lib/session';
import { LangSwitch, Logo, LogoMark } from '../components/ui';

type Mode = 'login' | 'register';

interface Meta {
  dataset: { source: string; fetchedAt: string; points: number; brigades: number; hospitals: number } | null;
}

export default function Login() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const session = useSession();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'register' ? 'register' : 'login');
  const [form, setForm] = useState({ username: '', password: '', name: '', phone: '' });
  const [mobilityImpaired, setMobilityImpaired] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<Meta | null>(null);
  const next = params.get('next');

  useEffect(() => {
    api<Meta>('/meta')
      .then(setMeta)
      .catch(() => undefined);
  }, []);

  if (session && !session.user.guest && !busy) {
    const target = next && (isStaff(session.user.role) || !next.startsWith('/dispatch')) ? next : homeFor(session.user.role);
    return <Navigate to={target} replace />;
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const s =
        mode === 'login'
          ? await api<Session>('/auth/login', { body: { username: form.username, password: form.password } })
          : await api<Session>('/auth/register', { body: { username: form.username, password: form.password, name: form.name, phone: form.phone, mobilityImpaired } });
      setSession(s);
      nav(next && (isStaff(s.user.role) || !next.startsWith('/dispatch')) ? next : homeFor(s.user.role), { replace: true });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'generic';
      setError((t.auth.errors as Record<string, string>)[code] ?? t.auth.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const input =
    'mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-500/15';

  return (
    <div className="flex min-h-full bg-slate-50 text-slate-900">
      {/* Brand panel */}
      <aside className="relative hidden w-[44%] overflow-hidden bg-gradient-to-br from-slate-800 via-slate-800 to-rose-900 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(248,113,113,0.30),transparent_55%),radial-gradient(ellipse_at_100%_100%,rgba(96,165,250,0.22),transparent_55%)]" />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative flex flex-1 flex-col justify-between p-10">
          <Link to="/">
            <Logo dark />
          </Link>
          <div>
            <div className="flex items-center gap-4">
              <LogoMark className="h-16 w-16 shrink-0 drop-shadow-[0_10px_30px_rgba(0,0,0,0.35)]" />
              <h1 className="text-6xl font-extrabold tracking-tight">
                Pani<span className="text-red-300">Go</span>
              </h1>
            </div>
            <p className="mt-5 max-w-md text-xl font-semibold leading-snug text-slate-100">{t.app.title}</p>
            <p className="mt-4 max-w-md text-slate-300">{t.app.tagline}</p>
            {meta?.dataset && (
              <div className="mt-10 max-w-md rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t.auth.dataTitle}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{t.auth.dataDesc}</div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <Stat icon={<Building2 className="h-4 w-4" />} n={meta.dataset.points} label={t.auth.stats.points} />
                  <Stat icon={<Siren className="h-4 w-4" />} n={meta.dataset.brigades} label={t.auth.stats.brigades} />
                  <Stat icon={<HeartPulse className="h-4 w-4" />} n={meta.dataset.hospitals} label={t.auth.stats.hospitals} />
                </div>
                <div className="mt-4 text-[10px] text-slate-400">© {meta.dataset.source}</div>
              </div>
            )}
          </div>
          <div className="text-xs text-slate-400">Digital Challenge Cup · Final</div>
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-1 flex-col">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(239,68,68,0.08),transparent_60%)]" />
        <header className="relative flex items-center justify-between px-4 py-4 sm:px-8">
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" /> <span className="lg:hidden">
              <Logo />
            </span>
          </Link>
          <LangSwitch />
        </header>

        <div className="relative flex flex-1 items-center justify-center px-4 pb-10 sm:px-8">
          <div className="w-full max-w-[420px] rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
            {/* Emergency first: no account needed to send SOS */}
            <Link
              to="/citizen"
              className="group flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 px-4 py-3.5 text-white shadow-lg shadow-red-500/30 transition hover:brightness-110 active:scale-[0.99]"
            >
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15">
                <span className="absolute inset-0 animate-ping rounded-xl bg-white/20" />
                <Siren className="relative h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-extrabold leading-tight">{t.auth.guest}</span>
                <span className="mt-0.5 block text-[11px] text-white/80">{t.auth.guestDesc}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 transition group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/citizen?care=1"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-xs font-semibold text-violet-800 transition hover:bg-violet-100"
            >
              <Accessibility className="h-4 w-4" /> {t.auth.guestCare}
            </Link>

            <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400">
              <span className="h-px flex-1 bg-slate-200" /> {t.auth.or} <span className="h-px flex-1 bg-slate-200" />
            </div>

            <h2 className="text-2xl font-bold tracking-tight">{mode === 'login' ? t.auth.welcome : t.auth.createAccount}</h2>
            <p className="mt-1.5 text-sm text-slate-500">{mode === 'login' ? t.auth.signInDesc : t.auth.signUpDesc}</p>

            <div className="mt-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold" role="tablist">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m);
                    setError('');
                  }}
                  className={clsx('flex items-center justify-center gap-1.5 rounded-lg py-2 transition', mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900')}
                >
                  {m === 'login' ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                  {m === 'login' ? t.auth.signIn : t.auth.signUp}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              {mode === 'register' && (
                <label className="block text-xs font-semibold text-slate-600">
                  {t.auth.fullName}
                  <input required minLength={2} maxLength={64} value={form.name} onChange={set('name')} autoComplete="name" className={input} />
                </label>
              )}
              <label className="block text-xs font-semibold text-slate-600">
                {t.dispatch.username}
                <input required value={form.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" spellCheck={false} className={input} />
                {mode === 'register' && <span className="mt-1 block text-[11px] text-slate-400">{t.auth.usernameHint}</span>}
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                {t.dispatch.password}
                <div className="relative">
                  <input
                    required
                    type={showPw ? 'text' : 'password'}
                    value={form.password}
                    onChange={set('password')}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    className={clsx(input, 'pr-10')}
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2.5 top-1/2 mt-[3px] -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700" aria-label={t.common.showPassword}>
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {mode === 'register' && <span className="mt-1 block text-[11px] text-slate-400">{t.auth.passwordHint}</span>}
              </label>
              {mode === 'register' && (
                <label className="block text-xs font-semibold text-slate-600">
                  {t.auth.phone}
                  <input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" placeholder="+994 50 000 00 00" className={input} />
                </label>
              )}

              {mode === 'register' && (
                <label className={clsx('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition', mobilityImpaired ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:bg-slate-50')}>
                  <input type="checkbox" checked={mobilityImpaired} onChange={(e) => setMobilityImpaired(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-600" />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <Accessibility className="h-4 w-4 text-violet-600" /> {t.auth.mobilityLabel}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{t.auth.mobilityHint}</span>
                  </span>
                </label>
              )}

              {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}

              <button
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 py-3 text-sm font-bold text-white shadow-lg shadow-red-500/25 transition hover:brightness-110 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === 'login' ? t.auth.signIn : t.auth.createAccount}
              </button>
            </form>

            <p className="mt-6 text-center text-[11px] text-slate-400">{t.dispatch.demoHint}</p>
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-slate-500">{icon}</div>
      <div className="mt-1 font-mono text-2xl font-semibold">{n}</div>
      <div className="text-[11px] leading-tight text-slate-400">{label}</div>
    </div>
  );
}
