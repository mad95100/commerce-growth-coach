/**
 * Internationalisation. UI strings are written in English inside t(); the
 * Arabic dictionary maps them (src/lib/i18n-ar.ts). A unit test fails when a
 * t("…") string has no Arabic entry. Arabic switches the page to RTL.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AR } from "./i18n-ar.ts";

export type Lang = "en" | "ar";
const STORAGE_KEY = "bsg-lang";

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

let current: Lang = typeof window === "undefined" ? "en" : initialLang();

export function lang(): Lang {
  return current;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = current === "ar" ? (AR[key] ?? key) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

function applyDocument(l: Lang) {
  document.documentElement.lang = l;
  document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
}

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "en", setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [l, setL] = useState<Lang>(current);
  useEffect(() => applyDocument(l), [l]);
  const setLang = useCallback((next: Lang) => {
    current = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
    setL(next);
  }, []);
  // Remount on change so every t() call re-renders in the new language.
  return (
    <LangContext.Provider value={{ lang: l, setLang }}>
      <div key={l} className="contents">
        {children}
      </div>
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
