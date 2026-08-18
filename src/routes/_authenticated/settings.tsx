import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PlanUsageCard } from "@/components/PlanUsageCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DEFAULT_EXPERIENCE_LEVEL,
  EXPERIENCE_CHOICES,
  type ExperienceLevel,
} from "@/lib/store-profile";
import { toast } from "sonner";
import { donneesOuLeve } from "@/integrations/supabase/throw-on-error";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Paramètres — EcomPilot AI" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>(DEFAULT_EXPERIENCE_LEVEL);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setEmail(u.user?.email ?? "");
      const { data: p } = await supabase
        .from("profiles")
        .select("full_name, experience_level")
        .eq("user_id", u.user?.id ?? "")
        .maybeSingle();
      setFullName(p?.full_name ?? "");
      setExperienceLevel(p?.experience_level ?? DEFAULT_EXPERIENCE_LEVEL);
    })();
  }, []);

  async function save() {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      donneesOuLeve(
        await supabase
          .from("profiles")
          .update({ full_name: fullName, experience_level: experienceLevel })
          .eq("user_id", u.user!.id),
      );
      toast.success("Profil mis à jour");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      {/*
        DEUX LARGEURS EMPILÉES, ET LA PAGE PARAISSAIT CASSÉE.

        La carte de plan occupait toute la largeur du cadre (`max-w-6xl`), et le
        formulaire juste en dessous s'arrêtait à `max-w-lg` — trois fois plus
        étroit. Sur un écran large, la page se lisait comme deux morceaux
        d'interfaces différentes posés l'un sur l'autre, avec un grand vide à
        droite du second. Une seule colonne, une seule largeur.

        `space-y-8` remplace les marges posées bloc par bloc : le rythme
        vertical vient d'un seul endroit, et un bloc ajouté demain s'y range
        sans qu'on ait à y penser.
      */}
      <div className="mx-auto max-w-2xl space-y-8">
        <h1 className="font-display text-3xl font-bold">Paramètres</h1>

        <PlanUsageCard />

        <div className="card-elevated space-y-5 rounded-2xl p-6">
          <div>
            <h2 className="font-display text-lg font-bold">Votre compte</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ces réglages valent pour toutes vos boutiques.
            </p>
          </div>
          <div>
            <Label htmlFor="email">Adresse e-mail</Label>
            <Input id="email" value={email} disabled />
            {/* UN CHAMP GRISÉ SANS EXPLICATION laisse croire à une panne. */}
            <p className="mt-1 text-xs text-muted-foreground">
              C'est l'adresse qui identifie votre compte. Elle ne se modifie pas depuis cet écran.
            </p>
          </div>
          <div>
            <Label htmlFor="name">Votre prénom</Label>
            <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label>Votre niveau en e-commerce</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Cela ajuste le style et le niveau de détail de vos audits.
            </p>
            <RadioGroup
              className="mt-3 gap-2"
              value={experienceLevel}
              onValueChange={(next) => setExperienceLevel(next as ExperienceLevel)}
              disabled={loading}
            >
              {EXPERIENCE_CHOICES.map((choice) => (
                <label
                  key={choice.value}
                  htmlFor={`experience-${choice.value}`}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-3 transition-colors hover:border-primary/40"
                >
                  <RadioGroupItem
                    id={`experience-${choice.value}`}
                    value={choice.value}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{choice.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {choice.description}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
          <Button
            onClick={save}
            disabled={loading}
            className="bg-gradient-primary text-primary-foreground"
          >
            Enregistrer
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
