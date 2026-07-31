import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CheckCircle2, Link2, Loader2, ShoppingBag, Facebook, Chrome, BarChart3 } from "lucide-react";
import { startShopifyConnect } from "@/lib/connectors/shopify.functions";
import { startMetaConnect } from "@/lib/connectors/meta.functions";
import { startGoogleAdsConnect } from "@/lib/connectors/google.functions";
import { disconnectProvider } from "@/lib/connectors/connections.functions";

type Connection = {
  id: string;
  provider: "shopify" | "meta_ads" | "google_ads" | "ga4";
  status: string;
  account_label: string | null;
  connected_at: string | null;
};

export function ConnectionsPanel({ storeId, storeUrl }: { storeId: string; storeUrl: string | null }) {
  const qc = useQueryClient();
  const startShopify = useServerFn(startShopifyConnect);
  const disconnect = useServerFn(disconnectProvider);
  const startMeta = useServerFn(startMetaConnect);
  const startGoogle = useServerFn(startGoogleAdsConnect);
  const [shopInput, setShopInput] = useState(() => guessShopFromUrl(storeUrl));
  const [busy, setBusy] = useState<string | null>(null);

  const connsQ = useQuery({
    queryKey: ["connections", storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_connections")
        .select("id, provider, status, account_label, connected_at")
        .eq("store_id", storeId);
      if (error) throw error;
      return data as Connection[];
    },
  });

  const conns = connsQ.data ?? [];
  const shopifyConn = conns.find((c) => c.provider === "shopify" && c.status === "active");
  const metaConn = conns.find((c) => c.provider === "meta_ads" && c.status === "active");
  const googleConn = conns.find((c) => c.provider === "google_ads" && c.status === "active");

  async function handleConnectAds(provider: "meta_ads" | "google_ads") {
    setBusy(provider);
    try {
      const { authorizeUrl } =
        provider === "meta_ads"
          ? await startMeta({ data: { storeId } })
          : await startGoogle({ data: { storeId } });
      window.location.href = authorizeUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
      setBusy(null);
    }
  }

  async function handleDisconnect(provider: "shopify" | "meta_ads" | "google_ads") {
    setBusy(provider);
    try {
      await disconnect({ data: { storeId, provider } });
      await qc.invalidateQueries({ queryKey: ["connections", storeId] });
      toast.success("Source déconnectée");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  async function handleConnectShopify() {
    if (!shopInput.trim()) {
      toast.error("Renseigne ton domaine Shopify (ex : monshop.myshopify.com)");
      return;
    }
    setBusy("shopify");
    try {
      const { authorizeUrl } = await startShopify({ data: { storeId, shopDomain: shopInput } });
      window.location.href = authorizeUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
      setBusy(null);
    }
  }

  async function handleDisconnectShopify() {
    setBusy("shopify");
    try {
      await disconnect({ data: { storeId, provider: "shopify" } });
      await qc.invalidateQueries({ queryKey: ["connections", storeId] });
      toast.success("Shopify déconnecté");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card-elevated rounded-2xl p-6">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <h2 className="font-display text-lg font-bold">Sources de données</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Branche tes outils pour un audit basé sur tes vraies données (ventes, pubs, trafic).
      </p>

      <div className="mt-5 space-y-3">
        {/* Shopify */}
        <div className="rounded-xl border border-border/60 bg-background/40 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-medium">Shopify</div>
                {shopifyConn && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-xs text-success">
                    <CheckCircle2 className="h-3 w-3" /> Connecté
                  </span>
                )}
              </div>
              {shopifyConn ? (
                <>
                  <div className="mt-0.5 text-xs text-muted-foreground">{shopifyConn.account_label}</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDisconnectShopify}
                    disabled={busy === "shopify"}
                    className="mt-3"
                  >
                    Déconnecter
                  </Button>
                </>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Input
                    value={shopInput}
                    onChange={(e) => setShopInput(e.target.value)}
                    placeholder="monshop.myshopify.com"
                    className="max-w-xs"
                  />
                  <Button
                    size="sm"
                    onClick={handleConnectShopify}
                    disabled={busy === "shopify"}
                    className="bg-gradient-primary text-primary-foreground"
                  >
                    {busy === "shopify" ? (
                      <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Redirection...</>
                    ) : (
                      "Connecter"
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <AdsRow
          icon={Facebook}
          label="Meta Ads"
          hint="Créations, ciblage et budgets corrigés automatiquement"
          conn={metaConn}
          busy={busy === "meta_ads"}
          onConnect={() => handleConnectAds("meta_ads")}
          onDisconnect={() => handleDisconnect("meta_ads")}
        />
        <AdsRow
          icon={Chrome}
          label="Google Ads"
          hint="Annonces, mots-clés exclus et budgets corrigés automatiquement"
          conn={googleConn}
          busy={busy === "google_ads"}
          onConnect={() => handleConnectAds("google_ads")}
          onDisconnect={() => handleDisconnect("google_ads")}
        />
        <SoonRow icon={BarChart3} label="Google Analytics 4" />
      </div>
    </div>
  );
}

function AdsRow({
  icon: Icon,
  label,
  hint,
  conn,
  busy,
  onConnect,
  onDisconnect,
}: {
  icon: typeof ShoppingBag;
  label: string;
  hint: string;
  conn: Connection | undefined;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-medium">{label}</div>
            {conn && (
              <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-xs text-success">
                <CheckCircle2 className="h-3 w-3" /> Connecté
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {conn?.account_label ?? hint}
          </div>
          <Button
            size="sm"
            variant={conn ? "outline" : "default"}
            onClick={conn ? onDisconnect : onConnect}
            disabled={busy}
            className={conn ? "mt-3" : "mt-3 bg-gradient-primary text-primary-foreground"}
          >
            {busy ? (
              <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Patiente...</>
            ) : conn ? (
              "Déconnecter"
            ) : (
              "Connecter"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SoonRow({ icon: Icon, label }: { icon: typeof ShoppingBag; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/20 p-4 opacity-70">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">Bientôt — OAuth en cours de branchement</div>
      </div>
    </div>
  );
}

function guessShopFromUrl(url: string | null): string {
  if (!url) return "";
  try {
    const host = new URL(url).host.toLowerCase();
    if (host.endsWith(".myshopify.com")) return host;
  } catch {
    // ignore
  }
  return "";
}
