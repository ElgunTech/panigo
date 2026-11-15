import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { az, type Dict } from './az';
import { en } from './en';

/**
 * Lightweight, dependency-free i18n. Registering a new language = add the
 * dictionary to LANGS (TypeScript enforces that every key is translated).
 */
export const LANGS = {
  az: { label: 'AZ', dict: az },
  en: { label: 'EN', dict: en },
} satisfies Record<string, { label: string; dict: Dict }>;

export type Lang = keyof typeof LANGS;

interface Ctx {
  lang: Lang;
  t: Dict;
  setLang: (l: Lang) => void;
  fmt: (tpl: string, vars: Record<string, string | number>) => string;
}

const I18nContext = createContext<Ctx | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('panigo.lang');
    if (saved && saved in LANGS) return saved as Lang;
  } catch {
    /* storage unavailable */
  }
  const nav = navigator.language?.slice(0, 2);
  return nav && nav in LANGS ? (nav as Lang) : 'az';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem('panigo.lang', l);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<Ctx>(
    () => ({
      lang,
      t: LANGS[lang].dict,
      setLang,
      fmt: (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')),
    }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const c = useContext(I18nContext);
  if (!c) throw new Error('useI18n outside provider');
  return c;
}
