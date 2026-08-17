import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import { PLAN_LIMITS, quotaLimit, remainingQuota, quotaExhaustedMessage } from "@/lib/plans";

/**
 * CE QUE LE COMPTEUR MONTRE EST CE QUE LE PLAN CONTIENT.
 *
 * LE DÉFAUT. La carte du plan affichait `used + remaining`. La somme paraît
 * juste, et elle l'est presque toujours — c'est ce « presque » qui coûte. Car
 * `remainingQuota` ne descend JAMAIS sous zéro : c'est un choix délibéré, un
 * solde négatif n'ayant pas de sens à afficher. Dès que la consommation dépasse
 * le plafond, le reste vaut 0 et la somme ne vaut plus le plafond : elle vaut
 * la consommation elle-même.
 *
 * Le marchand lisait alors « 4 / 4 utilisés » sur un plan qui en inclut 3 —
 * son propre dépassement présenté comme son allocation. Et l'écran suivant,
 * celui du refus, lui annonçait « vos 3 audits du mois » : deux chiffres pour
 * le même plan, à deux clics d'écart. Celui qui compte ses passages n'a alors
 * plus aucun moyen de savoir lequel croire.
 *
 * ET LE DÉPASSEMENT N'EST PAS THÉORIQUE. La suite « Abonnements » le démontre
 * déjà sur la concurrence : deux appels partis ensemble alors qu'il restait une
 * unité passent tous deux le contrôle, et le compare-and-swap compte
 * fidèlement les deux. Le compteur vaut alors plafond + 1. C'est un cas rare,
 * pas un cas impossible — et un affichage n'a le droit de se tromper sur aucun.
 *
 * CE QUI EST VÉRIFIÉ ICI. D'abord l'arithmétique, sur les fonctions pures :
 * qu'il EXISTE un état où la somme ment. Ensuite que l'affichage ne s'y expose
 * plus, en lisant la limite au lieu de la reconstituer.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const carte = readFileSync(`${ROOT}src/components/PlanUsageCard.tsx`, "utf8");
const sansCommentaires = carte.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

export default defineSuite("Abonnements — le compteur affiché dit le vrai plan", (t) => {
  // =========================================================================
  // 1. L'arithmétique : la somme ment, et voici exactement quand
  // =========================================================================
  const limite = PLAN_LIMITS.free.audits!;
  t.check("le plan gratuit a bien un plafond fini", Number.isFinite(limite), true);

  // En deçà du plafond, la somme et la limite coïncident — c'est pourquoi le
  // défaut a pu vivre si longtemps sans être vu.
  for (let used = 0; used < limite; used++) {
    t.check(
      `à ${used} audits consommés, la somme vaut encore le plafond`,
      used + (remainingQuota("free", "audits", used) ?? 0),
      limite,
    );
  }

  // AU DÉPASSEMENT, ELLES DIVERGENT. C'est le seul contrôle qui compte ici.
  const dépassé = limite + 1;
  t.check("le solde ne descend pas sous zéro", remainingQuota("free", "audits", dépassé), 0);
  t.check(
    "la somme ne vaut alors plus le plafond, mais la consommation",
    dépassé + (remainingQuota("free", "audits", dépassé) ?? 0),
    dépassé,
  );
  t.check("alors que le plafond, lui, n'a pas bougé", quotaLimit("free", "audits"), limite);

  // LE DÉSACCORD ENTRE DEUX ÉCRANS, rendu explicite. Le message de refus cite
  // le plafond ; la somme citait la consommation. Les deux phrases coexistaient.
  const refus = quotaExhaustedMessage("free", "audits");
  t.check("le message de refus cite le plafond", refus.includes(String(limite)), true);
  t.check(
    "et il ne cite pas le nombre qu'affichait la somme",
    refus.includes(`${dépassé} audits`),
    false,
  );

  // Le plan sans limite n'a pas de plafond à afficher : il ne doit pas tomber
  // dans la même case.
  t.check("le plan pro n'a pas de plafond", quotaLimit("pro", "audits"), null);
  t.check("et pas de solde à décompter", remainingQuota("pro", "audits", 999), null);

  // =========================================================================
  // 2. L'affichage lit la limite au lieu de la reconstituer
  // =========================================================================
  t.check("la carte lit la limite du plan", /quotaLimit\(e\.tier, key\)/.test(carte), true);
  t.check(
    "elle ne reconstitue plus le total par addition",
    /used \+ left/.test(sansCommentaires),
    false,
  );
  t.check("et c'est la limite qui est affichée", /\$\{used\} \/ \$\{limit\}/.test(carte), true);
  t.check(
    "le cas sans limite garde son libellé propre",
    /sans limite/.test(carte) && /limit === null/.test(carte),
    true,
  );

  // =========================================================================
  // 3. Une lecture ratée se dit ; elle ne s'efface pas
  // =========================================================================
  // La carte faisait `return null` sur l'échec : un blanc à l'endroit exact où
  // le marchand vient vérifier ce qui lui reste. Rien ne distinguait « la
  // lecture a échoué » de « vous n'avez pas de plan », et c'est la seconde
  // lecture qu'on fait devant un vide.
  t.check("l'échec de lecture est traité", /q\.isError/.test(carte), true);
  t.check("il affiche l'état d'échec du produit", /<ErrorState/.test(carte), true);
  t.check("et il propose de réessayer", /onRetry=/.test(carte), true);
  t.check(
    "le message rassure sur ce qui n'a PAS été touché",
    /compteurs ne sont pas touchés/.test(carte),
    true,
  );
  // Le chargement reste distinct de l'échec : trois états, pas deux.
  t.check("le chargement a son propre état", /q\.isLoading/.test(carte), true);
});
