/**
 * CE QUI EST DIAGNOSTICABLE, ET CE QUI NE L'EST PAS.
 *
 * LE CHAÎNON QUI MANQUAIT. Le moteur recevait des chiffres et demandait au
 * modèle de trouver ce qui n'allait pas. Rien ne disait quelles conclusions les
 * données présentes AUTORISENT réellement — si bien que l'absence de donnée ne
 * produisait pas un « je ne sais pas », mais une hypothèse formulée avec le
 * même aplomb qu'un fait.
 *
 * Ce catalogue renverse la logique. Chaque diagnostic déclare **ce dont il a
 * besoin pour être seulement envisagé**. Le moteur confronte cette liste aux
 * observations réellement obtenues et produit deux ensembles :
 *
 * - ce qui est INVESTIGABLE, avec la preuve à l'appui ;
 * - ce qui est HORS DE PORTÉE, avec le nom exact de la donnée qui manque.
 *
 * Le second ensemble part dans le prompt comme une interdiction. C'est la
 * différence entre « je ne trouve pas de problème de prix » et « je ne peux
 * rien dire sur le prix, je n'ai aucun point de comparaison » — la première
 * phrase est fausse, la seconde est utile.
 *
 * L'EXEMPLE QUI COMMANDE LA CONCEPTION : beaucoup de produits consultés, très
 * peu achetés. Les causes possibles sont nombreuses — prix, offre, confiance,
 * description, disponibilité, friction du tunnel. Certaines sont DÉMONTRABLES
 * avec ce que Shopify donne (une fiche sans description, un produit en rupture,
 * un tunnel à trois étapes). D'autres ne le sont pas sans données de trafic ou
 * de marché. Le moteur doit sortir les premières comme des faits, et les
 * secondes comme des hypothèses explicitement étiquetées.
 *
 * Module PUR.
 */

import type { Category } from "@/lib/scoring";
import type { Observation, ObservationGap } from "@/lib/observations";

export type Diagnostic = {
  /** Identifiant stable. */
  id: string;
  /** Ce qu'on cherche à établir, formulé comme une question. */
  question: string;
  domain: Category;
  /**
   * Observations SANS LESQUELLES ce diagnostic ne peut pas être posé.
   * Toutes requises : une seule manquante le rend hors de portée.
   */
  requires: string[];
  /**
   * Observations qui l'affinent sans être indispensables. Leur absence
   * dégrade la confiance, elle n'interdit pas de conclure.
   */
  refines?: string[];
  /** Ce que le diagnostic permet d'affirmer, une fois posé. */
  concludes: string;
};

/**
 * Le catalogue.
 *
 * Volontairement court et explicite plutôt qu'exhaustif : chaque entrée doit
 * correspondre à une donnée qu'un connecteur produit RÉELLEMENT. Un diagnostic
 * dont les prérequis ne sont produits par aucune source n'est pas une ambition,
 * c'est une ligne morte — sauf s'il est là pour dire ce qui manque, ce qui est
 * le cas des trois derniers.
 */
export const DIAGNOSTICS: Diagnostic[] = [
  // --- Ce que Shopify permet réellement d'établir --------------------------
  {
    id: "catalogue.fiches_incompletes",
    question: "Des fiches produit sont-elles inexploitables en l'état ?",
    domain: "produit",
    requires: ["shopify.product_count", "shopify.products_without_description"],
    refines: ["shopify.products_without_image"],
    concludes:
      "Une fiche sans description ni visuel ne peut pas convertir : le visiteur n'a rien pour décider.",
  },
  {
    id: "catalogue.ruptures",
    question: "Des produits sont-ils vendus alors qu'ils sont indisponibles ?",
    domain: "operations",
    requires: ["shopify.product_count", "shopify.products_out_of_stock"],
    concludes: "Un produit en rupture encore visible consomme du trafic sans pouvoir le convertir.",
  },
  {
    id: "offre.dispersion_prix",
    question: "L'offre est-elle lisible, ou les prix partent-ils dans tous les sens ?",
    domain: "offre",
    requires: ["shopify.price_min", "shopify.price_max", "shopify.price_median"],
    concludes:
      "Un écart de prix très large sans gamme claire empêche le visiteur de se situer et retarde la décision.",
  },
  {
    id: "conversion.abandon_panier",
    question: "Le tunnel perd-il des acheteurs déjà décidés ?",
    domain: "conversion",
    requires: ["shopify.abandoned_checkouts_30d", "shopify.orders_30d"],
    refines: ["shopify.cart_abandonment_rate"],
    concludes:
      "Un panier abandonné est un visiteur qui VOULAIT acheter : c'est la perte la plus chère et la plus réparable.",
  },
  {
    id: "rentabilite.remboursements",
    question: "Les remboursements mangent-ils la marge ?",
    domain: "rentabilite",
    requires: ["shopify.orders_30d", "shopify.refund_rate_30d"],
    refines: ["shopify.refunded_amount_30d"],
    concludes:
      "Un taux de remboursement élevé signale un écart entre ce qui est promis et ce qui est livré.",
  },
  {
    id: "rentabilite.dependance_promo",
    question: "La boutique vend-elle encore sans code de réduction ?",
    domain: "rentabilite",
    requires: ["shopify.orders_30d", "shopify.discounted_order_share"],
    concludes:
      "Une majorité de commandes sous code promo signale un prix de référence que le marché n'accepte pas.",
  },
  {
    id: "retention.reachat",
    question: "Les clients reviennent-ils ?",
    domain: "retention",
    requires: ["shopify.returning_customer_rate", "shopify.orders_30d"],
    concludes:
      "Sans réachat, chaque euro de chiffre d'affaires doit être racheté en acquisition. C'est le plafond le plus dur.",
  },
  {
    id: "offre.concentration",
    question: "Le chiffre d'affaires tient-il à un seul produit ?",
    domain: "offre",
    requires: ["shopify.top_product_revenue_share", "shopify.orders_30d"],
    concludes:
      "Une dépendance forte à un produit unique rend la boutique fragile, et concentre tout l'effort au bon endroit.",
  },
  {
    id: "offre.panier_moyen",
    question: "Le panier moyen est-il tenu par un seul article ?",
    domain: "offre",
    requires: ["shopify.aov", "shopify.multi_item_order_share"],
    concludes:
      "Des commandes mono-article laissent le panier moyen au niveau du produit d'appel : c'est le levier le moins cher.",
  },

  // --- Acquisition payante : ce que Meta établit seul ----------------------
  {
    id: "acquisition.depense_sans_resultat",
    question: "Des campagnes dépensent-elles sans produire un seul achat ?",
    domain: "acquisition",
    requires: ["meta.spend_30d", "meta.campaigns_without_result"],
    refines: ["meta.wasted_spend_30d"],
    concludes:
      "Une campagne qui dépense sans un seul achat attribué est le seul gaspillage qu'on puisse affirmer sans interprétation.",
  },
  {
    id: "acquisition.cout_du_clic",
    question: "Le trafic payant coûte-t-il trop cher pour ce panier moyen ?",
    domain: "acquisition",
    requires: ["meta.cpc_30d", "shopify.aov"],
    concludes:
      "Un coût par clic ne se juge que rapporté au panier moyen et au taux de transformation : seul, il ne dit rien.",
  },
  {
    id: "acquisition.accroche",
    question: "Les publicités donnent-elles envie de cliquer ?",
    domain: "acquisition",
    requires: ["meta.ctr_30d", "meta.impressions_30d"],
    concludes:
      "Un taux de clic bas est un fait ; sa cause — création, message ou audience — reste une hypothèse à tester.",
  },
  {
    id: "acquisition.rentabilite_reelle",
    question: "La publicité rapporte-t-elle plus qu'elle ne coûte, en vrai ?",
    domain: "rentabilite",
    requires: ["meta.spend_30d", "shopify.revenue_30d"],
    concludes:
      "Le ROAS déclaré par Meta repose sur son attribution. Rapporté au chiffre d'affaires réel, le rapport change souvent d'ordre de grandeur.",
  },

  // --- Google Ads : ce qu'il établit seul ----------------------------------
  {
    id: "acquisition.google_depense_sans_resultat",
    question: "Des campagnes Google dépensent-elles sans convertir ?",
    domain: "acquisition",
    requires: ["google.spend_30d", "google.campaigns_without_result"],
    refines: ["google.wasted_spend_30d"],
    concludes:
      "Une campagne Google qui dépense sans une seule conversion est un gaspillage constatable, sans interprétation.",
  },
  {
    id: "acquisition.google_requete",
    question: "Les annonces Google répondent-elles à ce que les gens cherchent ?",
    domain: "acquisition",
    requires: ["google.ctr_30d", "google.impressions_30d"],
    concludes:
      "Sur Google, un taux de clic bas vient plus souvent d'un décalage entre la requête et l'annonce que d'un problème de création.",
  },
  {
    id: "acquisition.flux_produit",
    question: "Le flux produit porte-t-il une part significative du budget Google ?",
    domain: "produit",
    requires: ["google.shopping_spend_share", "shopify.products_without_description"],
    concludes:
      "Shopping et Performance Max se pilotent par le flux produit : titres, images et disponibilité y décident de la diffusion, pas les mots-clés.",
  },

  // --- LE croisement : ce qu'aucune source ne peut établir seule ------------
  {
    id: "croisement.attribution_canal",
    question: "Le problème d'acquisition est-il général, ou propre à un canal ?",
    domain: "acquisition",
    requires: ["meta.roas_30d", "google.roas_30d"],
    concludes:
      "Deux canaux mesurés séparent une contre-performance locale d'un problème d'offre commun aux deux. Avec un seul canal, les deux se confondent — et on coupe ce qui marchait.",
  },
  {
    id: "croisement.apres_clic",
    question: "Le trafic payant achète-t-il une fois arrivé sur la boutique ?",
    domain: "conversion",
    requires: ["meta.clicks_30d", "shopify.orders_30d"],
    refines: ["shopify.cart_abandonment_rate"],
    concludes:
      "Commandes rapportées aux clics : la seule mesure qui départage une publicité inefficace d'une boutique qui ne transforme pas. Ni Meta ni Shopify ne peut la calculer seul.",
  },

  // --- Ce qui exige des données qu'aucune source ne fournit encore ---------
  // Ces entrées ne sont PAS mortes : elles existent pour que le moteur sache
  // nommer précisément ce qui lui manque, au lieu de conclure dans le vide.
  {
    id: "conversion.taux",
    question: "Quelle part des visiteurs achète ?",
    domain: "conversion",
    requires: ["shopify.sessions_30d", "shopify.orders_30d"],
    concludes:
      "Le taux de conversion est la mesure qui départage un problème de trafic d'un problème de boutique.",
  },
  {
    id: "produit.vus_vs_achetes",
    question: "Quels produits sont consultés sans être achetés ?",
    domain: "produit",
    requires: ["shopify.product_views_30d", "shopify.product_purchases_30d"],
    concludes:
      "Un produit très consulté et jamais acheté isole le blocage sur la fiche elle-même : prix, description, confiance ou disponibilité.",
  },
  {
    id: "offre.positionnement_prix",
    question: "Le prix est-il cohérent avec le marché ?",
    domain: "offre",
    requires: ["shopify.price_median", "market.price_median"],
    concludes: "Un prix ne se juge que par comparaison. Seul, il ne dit rien.",
  },
  {
    id: "acquisition.dependance_budget",
    question: "Que resterait-il des ventes si le budget publicitaire s'arrêtait ?",
    domain: "acquisition",
    requires: ["organic.payant_order_share", "organic.attribution_coverage"],
    concludes:
      "C'est la question qui distingue une entreprise d'un robinet publicitaire, et aucune régie ne peut y répondre : elles ne voient que ce qu'elles ont apporté.",
  },
  {
    id: "acquisition.socle_organique",
    question: "Quelle part des ventes arrive sans qu'on la paie ?",
    domain: "acquisition",
    requires: ["organic.non_paid_order_share", "organic.attribution_coverage"],
    concludes:
      "Le seul chiffre qui dit si l'effort investi hors publicité produit quelque chose — et s'il vaut d'être poursuivi.",
  },
  {
    id: "acquisition.attribution_contradictoire",
    question: "Les régies s'attribuent-elles plus de ventes qu'il n'en est arrivé par le payant ?",
    domain: "acquisition",
    requires: ["organic.payant_order_share", "meta.purchases_30d"],
    concludes:
      "Un contrepoids indépendant au ROAS déclaré : les commandes appartiennent au marchand, pas à la régie qui les revendique.",
  },
  {
    id: "acquisition.canaux_naturels",
    question: "Quels canaux gratuits apportent réellement des commandes ?",
    domain: "acquisition",
    requires: ["organic.recherche_order_share", "organic.social_order_share"],
    concludes:
      "Savoir où l'audience se forme déjà, pour renforcer ce qui prend plutôt que de deviner par où commencer.",
  },
];

export type DiagnosticAvailability = {
  /** Diagnostics que les données permettent d'instruire. */
  available: Array<{ diagnostic: Diagnostic; degraded: string[] }>;
  /** Diagnostics hors de portée, avec la donnée exacte qui manque. */
  blocked: Array<{ diagnostic: Diagnostic; missing: string[] }>;
};

/**
 * Confronte le catalogue aux données réellement obtenues.
 *
 * Une observation dont la valeur est `null` NE COMPTE PAS comme présente : une
 * case vide n'est pas une mesure, et la traiter comme telle rouvrirait très
 * exactement la porte que ce module ferme.
 */
export function assessDiagnostics(observations: Observation[]): DiagnosticAvailability {
  const known = new Set(
    observations.filter((o) => o.value !== null || o.text != null).map((o) => o.id),
  );

  const available: DiagnosticAvailability["available"] = [];
  const blocked: DiagnosticAvailability["blocked"] = [];

  for (const diagnostic of DIAGNOSTICS) {
    const missing = diagnostic.requires.filter((id) => !known.has(id));
    if (missing.length > 0) {
      blocked.push({ diagnostic, missing });
      continue;
    }
    const degraded = (diagnostic.refines ?? []).filter((id) => !known.has(id));
    available.push({ diagnostic, degraded });
  }

  return { available, blocked };
}

/**
 * Le bloc de cadrage injecté dans la demande d'audit.
 *
 * Il dit au modèle ce qu'il a le droit d'affirmer et ce qu'il n'a pas le droit
 * de conclure — nommément, diagnostic par diagnostic. C'est la barrière la plus
 * en amont contre l'invention : celle qui agit avant que la phrase ne soit
 * écrite, plutôt qu'après.
 */
export function diagnosticsToPromptBlock(
  availability: DiagnosticAvailability,
  gaps: ObservationGap[] = [],
): string {
  const parts: string[] = [];

  if (availability.available.length > 0) {
    const lines = availability.available.map(({ diagnostic, degraded }) => {
      const reserve =
        degraded.length > 0 ? " (donnée complémentaire absente : reste prudent sur l'ampleur)" : "";
      return `- ${diagnostic.question}${reserve}`;
    });
    parts.push(
      `CE QUE LES DONNÉES TE PERMETTENT D'ÉTABLIR :\n${lines.join("\n")}\n` +
        `Sur ces points, appuie-toi sur les chiffres ci-dessus et cite-les dans "evidence.based_on".`,
    );
  }

  if (availability.blocked.length > 0) {
    const lines = availability.blocked.map(
      ({ diagnostic, missing }) => `- ${diagnostic.question} → il manque : ${missing.join(", ")}`,
    );
    parts.push(
      `CE QUE TU NE PEUX PAS ÉTABLIR, FAUTE DE DONNÉES :\n${lines.join("\n")}\n` +
        `INTERDICTION FORMELLE d'affirmer quoi que ce soit sur ces points. Si tu juges l'un d'eux important, dis explicitement quelle donnée il faudrait aller chercher, mets confiance "low" et laisse "evidence.based_on" VIDE — il sera classé « donnée manquante », ce qui est la bonne réponse.`,
    );
  }

  if (gaps.length > 0) {
    const lines = gaps.map((g) => `- ${g.label} : ${g.reason} (permettrait : ${g.wouldEnable})`);
    parts.push(`DONNÉES ABSENTES ET CE QU'ELLES DÉBLOQUERAIENT :\n${lines.join("\n")}`);
  }

  return parts.join("\n\n");
}
