import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Sources connectées et prêtes à recevoir des corrections automatiques. */
export const getApplyChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("data_connections")
      .select("provider, status, account_label")
      .eq("store_id", data.storeId)
      .eq("status", "active");

    const active = rows ?? [];
    return {
      shopify: active.some((r: { provider: string }) => r.provider === "shopify"),
      meta_ads: active.some((r: { provider: string }) => r.provider === "meta_ads"),
      google_ads: active.some((r: { provider: string }) => r.provider === "google_ads"),
    };
  });
