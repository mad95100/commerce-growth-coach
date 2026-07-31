import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Déconnecte n'importe quelle source de données d'une boutique. */
export const disconnectProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        storeId: z.string().uuid(),
        provider: z.enum(["shopify", "meta_ads", "google_ads", "ga4"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("data_connections")
      .delete()
      .eq("store_id", data.storeId)
      .eq("provider", data.provider);
    if (error) throw error;
    return { ok: true };
  });
