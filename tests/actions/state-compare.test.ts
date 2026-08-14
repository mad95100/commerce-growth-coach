/**
 * Contrôles de la comparaison stable d'état (correctif BUG-1).
 *
 * Aucun accès base : la normalisation jsonb est REPRODUITE selon la règle
 * documentée de PostgreSQL (tri par longueur de clé, puis octet par octet).
 * Elle n'est pas observée sur l'instance réelle, toujours injoignable.
 *
 * Script hors dépôt, non commité.
 */
import { sameActionState, stableStringify } from "../../src/lib/action-plan";
import { defineSuite } from "../../tests/harness";

export default defineSuite("Actions — comparaison stable des états", async (t) => {
  /** Aller-retour jsonb : réordonne les clés d'objet, préserve les tableaux. */
  function jsonbRoundTrip<T>(o: T): T {
    if (o === null || typeof o !== "object") return o;
    if (Array.isArray(o)) return o.map(jsonbRoundTrip) as unknown as T;
    const keys = Object.keys(o as object).sort((a, b) =>
      a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0,
    );
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = jsonbRoundTrip((o as Record<string, unknown>)[k]);
    return out as T;
  }

  // --- 1. Les 10 formes réelles de beforeValue survivent à l'aller-retour jsonb ---
  const shapes: Array<[string, Record<string, unknown> | null]> = [
    ["update_product", { title: "T", body_html: "<p>x</p>" }],
    ["create_discount_code", null],
    ["meta_update_budget", { daily_budget_eur: 20 }],
    ["meta_pause_adset", { status: "ACTIVE" }],
    ["meta_update_targeting", { targeting_summary: "large" }],
    ["meta_update_creative", { primary_text: "texte", headline: "titre" }],
    ["google_update_budget", { daily_budget_eur: 30 }],
    ["google_pause_campaign", { status: "ENABLED" }],
    ["google_add_negative_keywords", {}],
    ["google_update_rsa", { headlines: ["A", "B", "C"], descriptions: ["D1", "D2"] }],
  ];
  for (const [tool, before] of shapes) {
    t.check(
      `${tool} : aller-retour jsonb => pas de faux refus`,
      sameActionState(before, jsonbRoundTrip(before)),
      true,
    );
  }

  // --- 2. Le cas qui échouait : meta_update_creative, clés inversées ---
  t.check(
    "meta_update_creative : clés inversées => identique",
    sameActionState(
      { primary_text: "texte", headline: "titre" },
      { headline: "titre", primary_text: "texte" },
    ),
    true,
  );
  t.check(
    "meta_update_creative : ancien comportement JSON.stringify échouait bien",
    JSON.stringify({ primary_text: "texte", headline: "titre" }) ===
      JSON.stringify({ headline: "titre", primary_text: "texte" }),
    false,
  );

  // --- 3. Une VRAIE différence de valeur reste détectée, pour chaque forme ---
  t.check(
    "update_product : titre modifié => refus",
    sameActionState(
      { title: "T", body_html: "<p>x</p>" },
      { body_html: "<p>x</p>", title: "AUTRE" },
    ),
    false,
  );
  t.check(
    "meta_update_budget : budget modifié => refus",
    sameActionState({ daily_budget_eur: 20 }, { daily_budget_eur: 21 }),
    false,
  );
  t.check(
    "meta_pause_adset : statut modifié => refus",
    sameActionState({ status: "ACTIVE" }, { status: "PAUSED" }),
    false,
  );
  t.check(
    "meta_update_creative : texte modifié malgré clés inversées => refus",
    sameActionState(
      { primary_text: "texte", headline: "titre" },
      { headline: "titre", primary_text: "AUTRE" },
    ),
    false,
  );
  t.check(
    "google_update_rsa : un titre modifié => refus",
    sameActionState(
      { headlines: ["A", "B", "C"], descriptions: ["D1", "D2"] },
      { descriptions: ["D1", "D2"], headlines: ["A", "B", "ZZZ"] },
    ),
    false,
  );

  // --- 4. L'ordre des tableaux est porteur de sens : il ne doit PAS être neutralisé ---
  t.check(
    "tableau réordonné => refus (ordre significatif)",
    sameActionState({ headlines: ["A", "B", "C"] }, { headlines: ["C", "B", "A"] }),
    false,
  );
  t.check(
    "tableau : élément retiré => refus",
    sameActionState({ headlines: ["A", "B", "C"] }, { headlines: ["A", "B"] }),
    false,
  );

  // --- 5. Objets imbriqués : indépendance de l'ordre à tous les niveaux ---
  t.check(
    "imbriqué : clés internes inversées => identique",
    sameActionState(
      { a: { z: 1, y: 2 }, b: [{ q: 1, p: 2 }] },
      { b: [{ p: 2, q: 1 }], a: { y: 2, z: 1 } },
    ),
    true,
  );
  t.check(
    "imbriqué : valeur profonde modifiée => refus",
    sameActionState({ a: { z: 1, y: 2 } }, { a: { y: 2, z: 99 } }),
    false,
  );

  // --- 6. Cas limites : pas de confusion entre formes voisines ---
  t.check("null vs {} => refus", sameActionState(null, {}), false);
  t.check("null vs null => identique", sameActionState(null, null), true);
  t.check("{} vs {} => identique", sameActionState({}, {}), true);
  t.check("nombre vs chaîne => refus", sameActionState({ v: 20 }, { v: "20" }), false);
  t.check("null vs chaîne vide => refus", sameActionState({ v: null }, { v: "" }), false);
  t.check(
    "propriété undefined omise, comme JSON.stringify",
    sameActionState({ a: 1, b: undefined }, { a: 1 }),
    true,
  );
  t.check(
    "undefined dans un tableau => null, comme JSON.stringify",
    stableStringify({ v: [1, undefined, 3] }) === '{"v":[1,null,3]}',
    true,
  );
  t.check(
    "clé supplémentaire => refus",
    sameActionState({ status: "ACTIVE" }, { status: "ACTIVE", extra: 1 }),
    false,
  );
});
