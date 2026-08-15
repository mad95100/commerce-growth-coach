import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Liste les suivis « avant / après » d'une boutique, corrections les plus récentes en premier. */
export const getStoreTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("fix_outcomes")
      // La devise de la boutique accompagne le suivi : les gains attendus sont
      // des montants, et un montant sans unité n'est pas une information.
      .select("*, audit_findings(id, title, category, severity, audit_id), stores(currency)")
      .eq("store_id", data.storeId)
      .order("applied_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

/** Re-mesure les indicateurs et met à jour statuts + alertes. */
export const refreshTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { refreshStoreOutcomes } = await import("@/lib/tracking.server");
    return refreshStoreOutcomes(context.supabase as never, data.storeId);
  });
