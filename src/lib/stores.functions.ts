import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * SUPPRIMER UNE BOUTIQUE. Ce que cela emporte, et pourquoi c'est irréversible.
 *
 * POURQUOI CETTE FONCTION MANQUAIT, ET CE QUE CELA COÛTAIT. Rien ne permettait
 * de retirer une boutique. Une boutique ajoutée par erreur, ou dont le marchand
 * a cessé l'activité, restait indéfiniment : elle occupait la liste, comptait
 * dans les quotas, et le passage périodique continuait de la reprendre. Le seul
 * recours était de nous écrire.
 *
 * LA SUPPRESSION EST TOTALE, PAR CONSTRUCTION. Onze tables référencent la
 * boutique en `ON DELETE CASCADE` : audits, constats, actions, mesures,
 * instantanés, connexions. Effacer la ligne efface donc tout l'historique du
 * marchand sur cette boutique — c'est le comportement voulu, et c'est
 * exactement pourquoi l'interface exige de retaper le nom avant d'y consentir.
 *
 * LE JETON PARTENAIRE PART AVEC. La connexion Shopify est supprimée par la
 * cascade, donc le jeton chiffré aussi. Il n'y a rien à révoquer de notre côté :
 * un jeton que nous ne détenons plus ne peut plus servir. Le marchand qui veut
 * aussi retirer l'application de son admin Shopify doit le faire là-bas — nous
 * ne pouvons pas désinstaller une application à sa place.
 */
export const deleteStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        storeId: z.string().uuid(),
        /**
         * Le nom retapé par le marchand.
         *
         * Il ne protège pas contre un attaquant — celui-là connaît le nom. Il
         * protège contre le clic distrait, qui est le risque réel : une
         * suppression accidentelle est définitive et emporte tout l'historique.
         */
        confirmation: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: store } = await supabase
      .from("stores")
      .select("id, name, owner_id")
      .eq("id", data.storeId)
      .maybeSingle();

    // Le rôle de service contourne RLS : l'appartenance se vérifie ici, ou
    // nulle part. Le même message pour « inexistante » et « pas à vous » : la
    // distinction apprendrait quels identifiants existent.
    if (!store || store.owner_id !== userId) {
      return {
        ok: false as const,
        error: "Cette boutique n'est pas accessible depuis votre compte.",
      };
    }

    // Comparaison tolérante aux espaces et à la casse : le marchand retape un
    // nom, il ne saisit pas un mot de passe.
    const attendu = store.name.trim().toLowerCase();
    if (data.confirmation.trim().toLowerCase() !== attendu) {
      return {
        ok: false as const,
        error: "Le nom saisi ne correspond pas à celui de la boutique. Rien n'a été supprimé.",
      };
    }

    const { error } = await supabase.from("stores").delete().eq("id", data.storeId);
    if (error) {
      return {
        ok: false as const,
        error: "La suppression n'a pas abouti. Réessayez dans un instant.",
      };
    }
    return { ok: true as const };
  });
