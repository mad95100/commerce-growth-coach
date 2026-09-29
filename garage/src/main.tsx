import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen.ts";
import { SessionProvider } from "./app/session.tsx";
import { LangProvider } from "./lib/i18n.tsx";
import { ToastProvider } from "./components/ui/toast.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Permission and validation errors do not heal by retrying.
      retry: (count, error) => {
        const code = (error as { code?: string })?.code ?? "";
        const msg = (error as { message?: string })?.message ?? "";
        if (code === "42501" || code.startsWith("PGRST") || msg.startsWith("bsg.")) return false;
        return count < 2;
      },
      refetchOnWindowFocus: true,
    },
  },
});

const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LangProvider>
        <ToastProvider>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </ToastProvider>
      </LangProvider>
    </QueryClientProvider>
  </StrictMode>,
);
