import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  CheckCircle2,
  Link2,
  Loader2,
  ShoppingBag,
  Facebook,
  Chrome,
  BarChart3,
} from "lucide-react";
import { startShopifyConnect } from "@/lib/connectors/shopify.functions";
import { startMetaConnect, selectMetaAdAccount } from "@/lib/connectors/meta.functions";
import { startGoogleAdsConnect, selectGoogleAdsAccount } from "@/lib/connectors/google.functions";
import { describeAccountChoice, type AdAccount } from "@/lib/connectors/ad-accounts";
import { disconnectProvider } from "@/lib/connectors/connections.functions";

type Connection = {
  id: string;
  provider: "shopify" | "meta_ads" | "google_ads" | "ga4";
  status: string;
  account_id: string | null;
  account_label: string | null;
  connected_at: string | null;
  /** Comptes auxquels l'autorisation donne accès, relevés à la connexion. */
  metadata: unknown;
};

/**
 * Relit les comptes conservés à la connexion.
 *
 * Meta renvoie des objets nommés, Google de simples identifiants : les deux
 * formes vivent dans la même colonne et se relisent ici plutôt que dans le
 * rendu, où une donnée inattendue ferait tomber la page.
 */
function readAccounts(metadata: unknown): AdAccount[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as { accounts?: unknown; customers?: unknown };
  if (Array.isArray(m.accounts)) {
    return m.accounts
      .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
      .map((a) => ({
        id: String(a.id ?? ""),
        name: typeof a.name === "string" ? a.name : null,
        currency: typeof a.currency === "string" ? a.currency : null,
        status: typeof a.account_status === "number" ? a.account_status : null,
      }))
      .filter((a) => a.id.length > 0);
  }
  if (Array.isArray(m.customers)) {
    return m.customers
      .filter((c): c is string => typeof c === "string" && c.length > 0)
      .map((c) => ({ id: c, name: null }));
  }
  return [];
}

export function ConnectionsPanel({
  storeId,
  storeUrl,
  storeCurrency = null,
}: {
  storeId: string;
  storeUrl: string | null;
  /** Devise de la boutique : sans elle, aucune réserve de devise n'est émise. */
  storeCurrency?: string | null;
}) {
  const qc = useQueryClient();
  const startShopify = useServerFn(startShopifyConnect);
  const disconnect = useServerFn(disconnectProvider);
  const startMeta = useServerFn(startMetaConnect);
  const startGoogle = useServerFn(startGoogleAdsConnect);
  const chooseMeta = useServerFn(selectMetaAdAccount);
  const chooseGoogle = useServerFn(selectGoogleAdsAccount);
  const [shopInput, setShopInput] = useState(() => guessShopFromUrl(storeUrl));
  const [busy, setBusy] = useState<string | null>(null);

  const connsQ = useQuery({
    queryKey: ["connections", storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_connections")
        .select("id, provider, status, account_id, account_label, connected_at, metadata")
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
      redirectToAuthorization(authorizeUrl);
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
      toast.error("Renseignez votre domaine Shopify (ex : monshop.myshopify.com)");
      return;
    }
    setBusy("shopify");
    try {
      const { authorizeUrl } = await startShopify({ data: { storeId, shopDomain: shopInput } });
      redirectToAuthorization(authorizeUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
      setBusy(null);
    }
  }

  async function handleSelectAccount(provider: "meta_ads" | "google_ads", accountId: string) {
    setBusy(provider);
    try {
      if (provider === "meta_ads") await chooseMeta({ data: { storeId, accountId } });
      else await chooseGoogle({ data: { storeId, customerId: accountId } });
      await qc.invalidateQueries({ queryKey: ["connections", storeId] });
      toast.success("Compte publicitaire enregistré.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
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
        Branchez vos outils pour un audit fondé sur vos vraies données (ventes, publicité, trafic).
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
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {shopifyConn.account_label}
                  </div>
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
                      <>
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Redirection...
                      </>
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
          storeCurrency={storeCurrency}
          onConnect={() => handleConnectAds("meta_ads")}
          onDisconnect={() => handleDisconnect("meta_ads")}
          onSelectAccount={(id) => handleSelectAccount("meta_ads", id)}
        />
        <AdsRow
          icon={Chrome}
          label="Google Ads"
          hint="Annonces, mots-clés exclus et budgets corrigés automatiquement"
          conn={googleConn}
          busy={busy === "google_ads"}
          storeCurrency={storeCurrency}
          onConnect={() => handleConnectAds("google_ads")}
          onDisconnect={() => handleDisconnect("google_ads")}
          onSelectAccount={(id) => handleSelectAccount("google_ads", id)}
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
  storeCurrency,
  onConnect,
  onDisconnect,
  onSelectAccount,
}: {
  icon: typeof ShoppingBag;
  label: string;
  hint: string;
  conn: Connection | undefined;
  busy: boolean;
  storeCurrency: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSelectAccount: (accountId: string) => void;
}) {
  // QUEL COMPTE EST ANALYSÉ, ET QUI L'A CHOISI. Le retour d'autorisation
  // retenait le premier compte de la liste sans le dire. Un marchand qui gère
  // deux marques, ou dont l'agence figure en tête, lisait un diagnostic
  // cohérent, chiffré — et portant sur un compte qu'il n'utilise pas.
  const choix = conn
    ? describeAccountChoice({
        accounts: readAccounts(conn.metadata),
        selectedId: conn.account_id,
        storeCurrency,
        providerLabel: label,
      })
    : null;
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
          <div className="mt-0.5 text-xs text-muted-foreground">{choix ? choix.message : hint}</div>

          {/* LA RÉSERVE DE DEVISE PASSE AVANT LE CHOIX. Un coût par commande
              calculé sur deux devises n'est pas approximatif : il n'existe
              pas. Le marchand doit le lire avant de décider quoi que ce soit
              de son budget. */}
          {choix?.warning && (
            <p className="mt-2 rounded-lg bg-warning/10 p-2 text-xs leading-relaxed text-warning">
              {choix.warning}
            </p>
          )}

          {/* LE CHOIX NE S'OUVRE QUE S'IL Y A QUELQUE CHOSE À CHOISIR. Un
              sélecteur à une seule ligne ferait douter d'un réglage juste. */}
          {choix?.needsConfirmation && choix.accounts.length > 1 && (
            <div className="mt-3">
              <label
                htmlFor={`compte-${conn!.id}`}
                className="block text-xs font-medium text-muted-foreground"
              >
                Compte analysé pour cette boutique
              </label>
              <select
                id={`compte-${conn!.id}`}
                value={choix.selected?.id ?? ""}
                disabled={busy}
                onChange={(e) => e.target.value && onSelectAccount(e.target.value)}
                className="mt-1 w-full max-w-sm rounded-lg border border-border/50 bg-background px-3 py-2 text-sm"
              >
                <option value="">Choisir un compte…</option>
                {choix.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ? `${a.name} (${a.id})` : a.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Button
            size="sm"
            variant={conn ? "outline" : "default"}
            onClick={conn ? onDisconnect : onConnect}
            disabled={busy}
            className={conn ? "mt-3" : "mt-3 bg-gradient-primary text-primary-foreground"}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Patientez...
              </>
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

/**
 * Redirige vers la page d'autorisation du partenaire.
 *
 * L'URL est validée avant navigation : une valeur absente ou relative envoyait le
 * navigateur sur une adresse inexistante de l'application, ce qui se traduisait
 * par une page vide sans le moindre message.
 */
function redirectToAuthorization(authorizeUrl: string | undefined) {
  let target: URL;
  try {
    target = new URL(String(authorizeUrl));
  } catch {
    throw new Error(
      "Le serveur n'a pas renvoyé d'adresse d'autorisation valide. Vérifiez la configuration OAuth du projet.",
    );
  }
  if (target.protocol !== "https:") {
    throw new Error("Adresse d'autorisation refusée : elle doit être en HTTPS.");
  }
  window.location.href = target.toString();
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
