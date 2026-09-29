import clsx from "clsx";
import { CheckCircle2, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "bad";
}
const Ctx = createContext<(text: string, tone?: "ok" | "bad") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {items.map((i) => (
          <div
            key={i.id}
            className={clsx(
              "pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg",
              i.tone === "ok" ? "bg-ink" : "bg-bad",
            )}
          >
            {i.tone === "ok" ? <CheckCircle2 className="size-4 text-green-300" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
            {i.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
