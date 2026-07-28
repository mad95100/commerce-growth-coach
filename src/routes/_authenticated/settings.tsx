import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Paramètres — EcomPilot AI" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setEmail(u.user?.email ?? "");
      const { data: p } = await supabase.from("profiles").select("full_name").eq("user_id", u.user?.id ?? "").maybeSingle();
      setFullName(p?.full_name ?? "");
    })();
  }, []);

  async function save() {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("user_id", u.user!.id);
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
      <div className="card-elevated max-w-lg space-y-4 rounded-2xl p-6">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} disabled />
        </div>
        <div>
          <Label htmlFor="name">Ton prénom</Label>
          <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <Button onClick={save} disabled={loading} className="bg-gradient-primary text-primary-foreground">
          Enregistrer
        </Button>
      </div>
    </AppShell>
  );
}
