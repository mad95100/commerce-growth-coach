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
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName, experience_level: experienceLevel })
        .eq("user_id", u.user!.id);
      if (error) throw error;
      toast.success("Profil mis à jour");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-8 font-display text-3xl font-bold">Paramètres</h1>

      <div className="mb-8">
        <PlanUsageCard />
      </div>
      <div className="card-elevated max-w-lg space-y-4 rounded-2xl p-6">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} disabled />
        </div>
        <div>
          <Label htmlFor="name">Ton prénom</Label>
          <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <Label>Ton niveau en e-commerce</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Ça ajuste le ton et le niveau de détail de tes audits.
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
    </AppShell>
  );
}
