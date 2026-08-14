import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { StoreEconomicsFields } from "@/components/StoreEconomicsFields";
import { EMPTY_STORE_ECONOMICS, parseStoreEconomics } from "@/lib/store-profile";
import { Loader2, Rocket } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [{ title: "Ajoute ta boutique — EcomPilot AI" }],
  }),
  component: Onboarding,
});

function Onboarding() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    url: "",
    niche: "",
    monthly_ad_budget: "",
    monthly_revenue: "",
    goal: "",
  });
  const [economics, setEconomics] = useState(EMPTY_STORE_ECONOMICS);

  function upd<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const parsed = parseStoreEconomics(economics);
      if (!parsed.ok) {
        toast.error(parsed.message);
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Non connecté");
      const { data, error } = await supabase
        .from("stores")
        .insert({
          owner_id: userData.user.id,
          name: form.name,
          url: form.url || null,
          niche: form.niche || null,
          monthly_ad_budget: form.monthly_ad_budget ? Number(form.monthly_ad_budget) : null,
          monthly_revenue: form.monthly_revenue ? Number(form.monthly_revenue) : null,
          goal: form.goal || null,
          ...parsed.payload,
        })
        .select()
        .single();
      if (error) throw error;
      toast.success("Boutique ajoutée ! Prêt pour ton premier audit ?");
      navigate({ to: "/stores/$storeId", params: { storeId: data.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary">
            <Rocket className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold">Parle-nous de ta boutique</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ces infos servent à personnaliser ton audit. Rien n'est partagé.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card-elevated space-y-5 rounded-2xl p-8">
          <div>
            <Label htmlFor="name">Nom de ta boutique *</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => upd("name", e.target.value)}
              placeholder="Ex: Ma Boutique Zen"
              required
            />
          </div>
          <div>
            <Label htmlFor="url">URL de ta boutique</Label>
            <Input
              id="url"
              value={form.url}
              onChange={(e) => upd("url", e.target.value)}
              placeholder="https://maboutique.com"
              type="url"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Optionnel — mais recommandé pour un audit plus précis.
            </p>
          </div>
          <div>
            <Label htmlFor="niche">Ta niche / secteur</Label>
            <Input
              id="niche"
              value={form.niche}
              onChange={(e) => upd("niche", e.target.value)}
              placeholder="Ex: bijoux minimalistes, cosmétiques bio, accessoires tech..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="revenue">CA actuel (€/mois)</Label>
              <Input
                id="revenue"
                type="number"
                min="0"
                value={form.monthly_revenue}
                onChange={(e) => upd("monthly_revenue", e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="budget">Budget pub (€/mois)</Label>
              <Input
                id="budget"
                type="number"
                min="0"
                value={form.monthly_ad_budget}
                onChange={(e) => upd("monthly_ad_budget", e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div className="border-t border-border/60 pt-5">
            <h2 className="font-display text-lg font-bold">Ton modèle économique</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Facultatif, mais c'est ce qui permet à l'audit de chiffrer ta marge et ton bénéfice
              réel. Tu pourras compléter plus tard.
            </p>
            <div className="mt-5">
              <StoreEconomicsFields
                idPrefix="onboarding"
                value={economics}
                onChange={setEconomics}
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="goal">Ton objectif principal</Label>
            <Textarea
              id="goal"
              value={form.goal}
              onChange={(e) => upd("goal", e.target.value)}
              placeholder="Ex: atteindre 5000€/mois de CA d'ici 3 mois"
              rows={3}
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-gradient-primary text-primary-foreground"
            disabled={loading || !form.name}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enregistrer ma boutique
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
