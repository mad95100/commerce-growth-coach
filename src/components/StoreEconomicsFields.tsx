import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  SITUATION_CHOICES,
  type StoreEconomicsForm,
  type StoreSituation,
} from "@/lib/store-profile";
import { currencyLabel } from "@/lib/currency";

/**
 * Champs du profil économique d'une boutique, partagés entre l'onboarding et
 * l'écran d'édition. Composant purement présentationnel : il n'écrit jamais en base.
 * Tous les champs sont facultatifs — vide signifie « non renseigné » (stocké `null`).
 */
export function StoreEconomicsFields({
  value,
  onChange,
  idPrefix,
  disabled,
  currency,
}: {
  value: StoreEconomicsForm;
  onChange: (next: StoreEconomicsForm) => void;
  idPrefix: string;
  disabled?: boolean;
  /**
   * Devise de la boutique, code ISO 4217. `null` tant qu'elle n'est pas connue :
   * les libellés l'annoncent alors explicitement plutôt que d'afficher « € ».
   */
  currency?: string | null;
}) {
  const unit = currencyLabel(currency ?? null);
  function upd<K extends keyof StoreEconomicsForm>(key: K, next: StoreEconomicsForm[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="space-y-5">
      <div>
        <Label>Où en êtes-vous aujourd'hui ?</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Cela oriente l'audit vers ce qui vous bloque vraiment.
        </p>
        <RadioGroup
          className="mt-3 gap-2"
          value={value.situation}
          onValueChange={(next) => upd("situation", next as StoreSituation)}
          disabled={disabled}
        >
          {SITUATION_CHOICES.map((choice) => (
            <label
              key={choice.value}
              htmlFor={`${idPrefix}-situation-${choice.value}`}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-3 transition-colors hover:border-primary/40"
            >
              <RadioGroupItem
                id={`${idPrefix}-situation-${choice.value}`}
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idPrefix}-revenue-goal`}>Objectif de CA ({unit}/mois)</Label>
          <Input
            id={`${idPrefix}-revenue-goal`}
            type="number"
            min="0"
            step="100"
            inputMode="decimal"
            value={value.revenueGoal}
            onChange={(e) => upd("revenueGoal", e.target.value)}
            placeholder="5000"
            disabled={disabled}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-fixed-costs`}>Charges fixes ({unit}/mois)</Label>
          <Input
            id={`${idPrefix}-fixed-costs`}
            type="number"
            min="0"
            step="10"
            inputMode="decimal"
            value={value.fixedCostsMonthly}
            onChange={(e) => upd("fixedCostsMonthly", e.target.value)}
            placeholder="300"
            disabled={disabled}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Abonnements, outils, logistique — hors budget publicitaire.
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-cost-percent`}>Coût produit moyen (% du prix de vente)</Label>
        <Input
          id={`${idPrefix}-cost-percent`}
          type="number"
          min="0"
          max="100"
          step="1"
          inputMode="numeric"
          value={value.costPercent}
          onChange={(e) => upd("costPercent", e.target.value)}
          placeholder="40"
          disabled={disabled}
          className="max-w-40"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Ce que vous coûte un produit, en % de son prix de vente. Un produit acheté 20 et vendu 50
          = 40 %. Un pourcentage ne dépend d'aucune devise. C'est ce qui permet de calculer votre
          marge et votre bénéfice réel.
        </p>
      </div>
    </div>
  );
}
