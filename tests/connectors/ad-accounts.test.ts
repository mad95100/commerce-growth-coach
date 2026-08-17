import { readFileSync } from "node:fs";
import { defineSuite } from "../harness";
import {
  defaultAccount,
  describeAccountChoice,
  type AdAccount,
} from "@/lib/connectors/ad-accounts";

/**
 * SUR QUEL COMPTE PUBLICITAIRE PORTE LE DIAGNOSTIC.
 *
 * LE DÉFAUT QUE CETTE SUITE EXISTE POUR EMPÊCHER DE REVENIR. Le retour
 * d'autorisation Meta prenait `accounts[0]` et l'utilisait pour tout le
 * diagnostic publicitaire. Rien ne le disait au marchand, et rien ne lui
 * permettait d'en changer — alors que la fonction serveur qui le permet
 * existait, écrite et jamais appelée par un écran.
 *
 * Un marchand qui gère deux marques, qui a gardé un compte de test, ou dont
 * l'agence figure en tête de liste se voyait donc expliquer que « ses »
 * campagnes ne convertissent pas, sur un compte qu'il n'utilise pas.
 *
 * C'EST LA PIRE ERREUR QUE CE PRODUIT PUISSE COMMETTRE, parce qu'elle ne
 * ressemble pas à une panne : le rapport est cohérent, chiffré, argumenté et
 * faux de bout en bout. Un marchand qui s'en aperçoit ne recroit plus rien.
 */

const compte = (over: Partial<AdAccount> & { id: string }): AdAccount => ({
  name: null,
  currency: null,
  status: null,
  ...over,
});

export default defineSuite("Connexions — quel compte publicitaire est analysé", (t) => {
  // --- 1. Aucun compte : on ne prétend pas analyser ------------------------
  const aucun = describeAccountChoice({
    accounts: [],
    selectedId: null,
    storeCurrency: "EUR",
    providerLabel: "Meta Ads",
  });
  t.check("aucun compte : rien n'est sélectionné", aucun.selected, null);
  t.check("aucun compte : rien à confirmer", aucun.needsConfirmation, false);
  t.check("aucun compte : c'est dit", /aucun compte/i.test(aucun.message), true);

  // --- 2. Un seul compte : rien à choisir, mais on dit lequel --------------
  const seul = describeAccountChoice({
    accounts: [compte({ id: "act_1", name: "Boutique Neige", currency: "EUR" })],
    selectedId: "act_1",
    storeCurrency: "EUR",
    providerLabel: "Meta Ads",
  });
  t.check("un seul compte : pas de confirmation demandée", seul.needsConfirmation, false);
  t.check("un seul compte : il est nommé", /Boutique Neige/.test(seul.message), true);
  t.check("un seul compte : aucune réserve", seul.warning, null);

  // --- 3. Plusieurs comptes : LE DÉFAUT EST ANNONCÉ COMME UN DÉFAUT --------
  // C'est tout l'objet du module. Le silence transformerait un tirage au sort
  // en décision, et le marchand n'aurait aucun moyen de s'en apercevoir.
  const plusieurs = describeAccountChoice({
    accounts: [
      compte({ id: "act_1", name: "Agence Média", currency: "EUR" }),
      compte({ id: "act_2", name: "Boutique Neige", currency: "EUR" }),
    ],
    selectedId: "act_1",
    storeCurrency: "EUR",
    providerLabel: "Meta Ads",
  });
  t.check("plusieurs comptes : confirmation demandée", plusieurs.needsConfirmation, true);
  t.check(
    "le choix est présenté comme automatique",
    /choisi automatiquement/.test(plusieurs.message),
    true,
  );
  t.check("le marchand est invité à vérifier", /vérifiez/i.test(plusieurs.message), true);
  t.check("le compte retenu est nommé", /Agence Média/.test(plusieurs.message), true);
  t.check("les deux comptes restent proposés", plusieurs.accounts.length, 2);

  // Aucun compte retenu : on ne fait pas semblant d'analyser.
  const nonChoisi = describeAccountChoice({
    accounts: [compte({ id: "act_1" }), compte({ id: "act_2" })],
    selectedId: null,
    storeCurrency: "EUR",
    providerLabel: "Meta Ads",
  });
  t.check(
    "sans choix : rien n'est analysé, et c'est dit",
    /rien n'est analysé/.test(nonChoisi.message),
    true,
  );
  t.check("sans choix : aucune réserve de devise inventée", nonChoisi.warning, null);

  // Un compte disparu depuis la connexion n'est pas un compte.
  const disparu = describeAccountChoice({
    accounts: [compte({ id: "act_2" })],
    selectedId: "act_1",
    storeCurrency: "EUR",
    providerLabel: "Meta Ads",
  });
  t.check("un compte devenu inaccessible est signalé", disparu.selected, null);
  t.check("et un nouveau choix est demandé", disparu.needsConfirmation, true);

  // --- 4. DEUX DEVISES NE SE COMPARENT PAS --------------------------------
  // Un coût par commande calculé sur un compte en dollars et une boutique en
  // euros n'est pas approximatif : il n'existe pas. Le taire produirait
  // exactement le chiffre inventé que le moteur s'interdit partout ailleurs.
  const devises = describeAccountChoice({
    accounts: [compte({ id: "act_1", name: "US Brand", currency: "USD" })],
    selectedId: "act_1",
    storeCurrency: "EUR",
    providerLabel: "Meta Ads",
  });
  t.check("la différence de devise est relevée", devises.warning !== null, true);
  t.check("les deux devises sont nommées", /USD/.test(devises.warning ?? ""), true);
  t.check("et celle de la boutique aussi", /EUR/.test(devises.warning ?? ""), true);
  t.check(
    "la conséquence est dite, pas seulement le fait",
    /chiffre inventé|ne rapprochons pas/.test(devises.warning ?? ""),
    true,
  );
  // La casse et les espaces ne créent pas de fausse alerte.
  t.check(
    "une même devise écrite autrement ne déclenche rien",
    describeAccountChoice({
      accounts: [compte({ id: "a", currency: " eur " })],
      selectedId: "a",
      storeCurrency: "EUR",
      providerLabel: "Meta Ads",
    }).warning,
    null,
  );
  // SANS LES DEUX DEVISES, AUCUNE RÉSERVE. Une boutique dont la devise n'est
  // pas encore connue ne doit pas déclencher une alerte fondée sur rien.
  t.check(
    "une devise inconnue ne fabrique pas d'alerte",
    describeAccountChoice({
      accounts: [compte({ id: "a", currency: "USD" })],
      selectedId: "a",
      storeCurrency: null,
      providerLabel: "Meta Ads",
    }).warning,
    null,
  );
  t.check(
    "un compte sans devise déclarée non plus",
    describeAccountChoice({
      accounts: [compte({ id: "a", currency: null })],
      selectedId: "a",
      storeCurrency: "EUR",
      providerLabel: "Meta Ads",
    }).warning,
    null,
  );

  // --- 5. Le défaut retenu à la connexion ---------------------------------
  // Proposer d'emblée un compte désactivé garantit un diagnostic vide et une
  // impression de produit cassé.
  t.check("aucun compte : aucun défaut", defaultAccount([]), null);
  t.check(
    "le premier compte ACTIF est préféré",
    defaultAccount([compte({ id: "a", status: 2 }), compte({ id: "b", status: 1 })])?.id,
    "b",
  );
  t.check(
    "un statut inconnu n'écarte pas le compte",
    defaultAccount([compte({ id: "a", status: null })])?.id,
    "a",
  );
  t.check(
    "si aucun n'est actif, on prend quand même le premier",
    defaultAccount([compte({ id: "a", status: 3 }), compte({ id: "b", status: 2 })])?.id,
    "a",
  );

  // --- 6. L'écran s'en sert vraiment --------------------------------------
  // Le module précédent — celui qui permet de CHANGER de compte — existait
  // depuis le début et n'était appelé par aucun écran. C'est précisément ce
  // que ce contrôle empêche de reproduire.
  const racine = new URL("../../", import.meta.url).pathname;
  const panneau = readFileSync(`${racine}src/components/ConnectionsPanel.tsx`, "utf8");
  t.check("l'écran décrit le choix", /describeAccountChoice\(/.test(panneau), true);
  t.check("le marchand peut changer de compte Meta", /selectMetaAdAccount/.test(panneau), true);
  t.check("et de compte Google", /selectGoogleAdsAccount/.test(panneau), true);
  t.check("la réserve de devise est affichée", /choix\?\.warning/.test(panneau), true);
  t.check("la boutique transmet sa devise", /storeCurrency/.test(panneau), true);
  const page = readFileSync(`${racine}src/routes/_authenticated/stores.$storeId.tsx`, "utf8");
  t.check("la page passe la devise réelle", /storeCurrency=\{store\.currency\}/.test(page), true);

  // Le retour d'autorisation ne prend plus le premier venu.
  const callback = readFileSync(`${racine}src/routes/api/public/oauth/meta/callback.ts`, "utf8");
  t.check("le retour Meta écarte un compte désactivé", /defaultAccount\(/.test(callback), true);
  // Sur le CODE seul : le commentaire qui explique pourquoi `accounts[0]` a été
  // abandonné cite forcément `accounts[0]`, et interdire au code de se
  // documenter serait le pire des deux mondes.
  const callbackCode = callback.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  t.check("il ne prend plus le premier de la liste", /accounts\[0\]/.test(callbackCode), false);

  // --- 7. Une seule voie de déconnexion -----------------------------------
  // `disconnectShopify` doublait `disconnectProvider` en plus étroit, et aucun
  // écran ne l'appelait. Deux chemins pour un même geste finissent par
  // diverger : l'un reçoit une correction, pas l'autre.
  const shopify = readFileSync(`${racine}src/lib/connectors/shopify.functions.ts`, "utf8");
  t.check(
    "la voie de déconnexion parallèle a disparu",
    /export const disconnectShopify/.test(shopify),
    false,
  );
});
