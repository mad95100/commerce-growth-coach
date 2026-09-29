/**
 * Language provider: switches between English and Arabic (RTL). The
 * translation function itself lives in i18n-core.ts so plain modules and
 * tests can use it without React.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { lang as currentLang, setCurrentLang, STORAGE_KEY, type Lang } from "./i18n-core.ts";

export { t, tn, lang, type Lang } from "./i18n-core.ts";

function applyDocument(l: Lang) {
  document.documentElement.lang = l;
  document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
}

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "en", setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [l, setL] = useState<Lang>(currentLang());
  useEffect(() => applyDocument(l), [l]);
  const setLang = useCallback((next: Lang) => {
    setCurrentLang(next);
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
