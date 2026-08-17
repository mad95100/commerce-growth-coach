import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { StoreEconomicsFields } from "@/components/StoreEconomicsFields";
import { EMPTY_STORE_ECONOMICS, parseStoreEconomics } from "@/lib/store-profile";
import { Loader2, Rocket } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [{ title: "Ajoutez votre boutique — EcomPilot AI" }],
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
          url: form.url.trim() || null,
          niche: form.niche || null,
          monthly_ad_budget: form.monthly_ad_budget ? Number(form.monthly_ad_budget) : null,
          monthly_revenue: form.monthly_revenue ? Number(form.monthly_revenue) : null,
          goal: form.goal || null,
          ...parsed.payload,
        })
        .select()
        .single();
      if (error) throw error;
      toast.success("Boutique ajoutée ! Prêt pour votre premier audit ?");
      navigate({ to: "/stores/$storeId", params: { storeId: data.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    /*
      PAS DE BARRE DE NAVIGATION SUR CET ÉCRAN.

      CE QUI SE PASSAIT. L'onboarding s'affichait dans le cadre complet de
      l'application. Or on y arrive de deux façons, et la première est de loin
      la plus fréquente : un compte tout neuf ouvre `/dashboard`, qui ne trouve
      aucune boutique et redirige ici. Le marchand voyait donc une barre
      latérale proposant « Tableau de bord » — qui le ramène exactement où il
      est —, « Mes boutiques » — qui est vide —, et « Paramètres ». Trois
      sorties, dont deux qui bouclent, offertes au moment où il n'a qu'une seule
      chose à faire.

      L'écran est donc autonome, avec une seule issue explicite pour ceux qui
      ont déjà des boutiques et arrivent ici volontairement.
    */
    <div className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary">
            <Rocket className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold">Parlez-nous de votre boutique</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Deux champs suffisent pour commencer. Le reste affine le diagnostic et peut attendre.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card-elevated space-y-5 rounded-2xl p-8">
          <div>
            <Label htmlFor="name">
              Nom de votre boutique <Requis />
            </Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => upd("name", e.target.value)}
              placeholder="Ex: Ma Boutique Zen"
              required
            />
          </div>
          <div>
            <Label htmlFor="url">
              Adresse de votre boutique <Requis />
            </Label>
            <Input
              id="url"
              value={form.url}
              onChange={(e) => upd("url", e.target.value)}
              placeholder="https://maboutique.com"
              type="url"
              inputMode="url"
              required
            />
            {/*
              CE CHAMP ÉTAIT « OPTIONNEL — MAIS RECOMMANDÉ ». C'était faux, et
              coûteux : sans adresse, EcomPilot ne peut pas ouvrir la page que
              le visiteur reçoit. Il perd donc l'analyse de la page d'accueil,
              des fiches produit, du parcours d'achat, de la confiance — et une
              partie de la déduction du client cible, qui se lit en partie sur
              le site. Le marchand cochait « optionnel » sans savoir qu'il
              renonçait à un tiers de son audit.
            */}
            <p className="mt-1 text-xs text-muted-foreground">
              Sans elle, nous ne pouvons pas ouvrir votre boutique comme le fait un visiteur : ni
              votre page d'accueil, ni vos fiches produit, ni votre parcours d'achat ne seront
              analysés.
            </p>
          </div>
          {/*
            CE QUI EST EXIGÉ MAINTENANT, ET CE QUI PEUT ATTENDRE.

            Le formulaire alignait onze champs d'affilée, sans rien pour les
            distinguer. Seuls deux d'entre eux bloquent réellement le bouton —
            et rien ne le disait : l'astérisque n'était posé que sur le premier,
            alors que l'adresse est tout aussi obligatoire. Un marchand pressé
            renonçait devant la longueur, ou remplissait tout en croyant y être
            tenu, là où la page d'accueil lui avait promis une minute.
          */}
          <div className="border-t border-border/60 pt-5">
            <h2 className="font-display text-lg font-bold">Pour affiner le diagnostic</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tout ce qui suit est facultatif. Chaque réponse permet de chiffrer davantage, et vous
              pourrez compléter à tout moment depuis la page de votre boutique.
            </p>
          </div>
          <div>
            <Label htmlFor="niche">Votre niche / secteur</Label>
            <Input
              id="niche"
              value={form.niche}
              onChange={(e) => upd("niche", e.target.value)}
              placeholder="Ex: bijoux minimalistes, cosmétiques bio, accessoires tech..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="revenue">CA actuel (par mois)</Label>
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
              <Label htmlFor="budget">Budget pub (par mois)</Label>
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
          <div>
            <h3 className="font-display text-base font-bold">Votre modèle économique</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              C'est ce qui permet à l'audit de chiffrer votre marge et votre bénéfice réel.
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
            <Label htmlFor="goal">Votre objectif principal</Label>
            <Textarea
              id="goal"
              value={form.goal}
              onChange={(e) => upd("goal", e.target.value)}
              placeholder="Ex: atteindre 5000/mois de CA d'ici 3 mois"
              rows={3}
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-gradient-primary text-primary-foreground"
            disabled={loading || !form.name || !form.url}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enregistrer ma boutique
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Nous lisons votre boutique, nous n'y écrivons rien sans votre accord explicite.
          </p>
        </form>

        {/* La seule sortie de cet écran, pour qui a déjà des boutiques et arrive
            ici volontairement. Un compte neuf n'a rien à y trouver — le tableau
            de bord le renverrait ici. */}
        <div className="mt-6 text-center">
          <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            Revenir au tableau de bord
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Marque des champs sans lesquels le bouton reste inerte. */
function Requis() {
  return (
    <span className="text-destructive" aria-label="obligatoire">
      *
    </span>
  );
}
