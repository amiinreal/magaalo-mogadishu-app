import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import so from './so.json';

export type Language = 'en' | 'so';
export type StringKey = keyof typeof en;
type Vars = Record<string, string | number>;

const tables: Record<Language, Record<string, string>> = { en, so };
const STORAGE_KEY = 'magaalo.language';

export function translate(lang: Language, key: StringKey, vars?: Vars) {
  const template = tables[lang][key] ?? en[key] ?? key;
  return vars ? template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? '')) : template;
}

type I18n = { lang: Language; setLang: (lang: Language) => void; t: (key: StringKey, vars?: Vars) => string };
const I18nContext = createContext<I18n | null>(null);

// English is the default; Somali is opt-in from Settings → Language.
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>('en');
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(v => { if (v === 'en' || v === 'so') setLangState(v); }).catch(() => {});
  }, []);
  const setLang = useCallback((next: Language) => {
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);
  const t = useCallback((key: StringKey, vars?: Vars) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export function formatDistance(lang: Language, meters: number, spoken = false) {
  if (meters < 1000) {
    const n = meters < 100 ? Math.max(10, Math.round(meters / 10) * 10) : Math.round(meters / 50) * 50;
    return translate(lang, spoken ? 'speak.m' : 'unit.m', { n });
  }
  const km = meters / 1000;
  return translate(lang, spoken ? 'speak.km' : 'unit.km', { n: km < 10 ? km.toFixed(1) : Math.round(km) });
}

export function formatAgo(lang: Language, iso: string) {
  const minutes = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return translate(lang, 'time.justNow');
  if (minutes < 60) return translate(lang, 'time.minAgo', { n: Math.round(minutes) });
  if (minutes < 60 * 48) return translate(lang, 'time.hAgo', { n: Math.round(minutes / 60) });
  return translate(lang, 'time.dAgo', { n: Math.round(minutes / 1440) });
}

export function formatClock(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
