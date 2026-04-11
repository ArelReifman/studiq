import { create } from "zustand";
import en from "./locales/en.json";
import he from "./locales/he.json";

export type Locale = "en" | "he";

const translations: Record<Locale, Record<string, string>> = { en, he };

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

function getInitialLocale(): Locale {
  if (typeof document === "undefined") return "he";
  const match = document.cookie.match(/studiq-locale=(\w+)/);
  return (match?.[1] as Locale) ?? "he";
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: getInitialLocale(),
  setLocale: (locale) => {
    document.cookie = `studiq-locale=${locale}; path=/; max-age=31536000; SameSite=Lax`;
    set({ locale });
  },
}));

/**
 * Translation hook.
 * Returns a function t(key, params?) that looks up the current locale's string.
 * Supports {name}-style interpolation.
 */
export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  const dict = translations[locale] ?? translations.he;

  function t(key: string, params?: Record<string, string | number>): string {
    let str = dict[key] ?? translations.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  }

  return t;
}

export function isRtl(locale: Locale) {
  return locale === "he";
}
