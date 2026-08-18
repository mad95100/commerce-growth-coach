import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineSuite } from "../harness";

/**
 * LA PAGE NE DOIT PAS DÉFILER DE CÔTÉ.
 *
 * MESURÉ AU NAVIGATEUR, sur neuf écrans à six largeurs (320, 375, 414, 768,
 * 1024, 1440). Le pire cas : à 320 px, le document de la page boutique faisait
 * 1065 PIXELS — plus de trois fois le cadre. L'en-tête compris, tout défilait
 * latéralement ; il fallait balayer de côté pour lire chaque phrase, et le
 * bouton d'action principal se trouvait hors de l'écran.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA CAUSE, LA MÊME PARTOUT : `min-width: auto`.
 *
 * Un élément flexible ou un élément de grille refuse, par défaut, de descendre
 * sous la largeur intrinsèque de son contenu. Il suffit donc d'UN descendant
 * insécable — ici l'adresse d'une boutique, `https://atelier-lumen.myshopify.com`,
 * qui n'offre aucune coupure — pour que le conteneur s'élargisse, et avec lui
 * tout ce qui l'entoure jusqu'au document.
 *
 * C'est aussi pourquoi les `truncate` posés un peu partout ne tronquaient rien :
 * `text-overflow` n'agit que si le bloc a le droit d'être plus étroit que son
 * texte. Sans `min-w-0`, il ne l'a pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE CONTRÔLE PROTÈGE. Les endroits précis où le correctif a été posé.
 * Il ne remplace pas la mesure au navigateur — aucune lecture de source ne
 * calcule une largeur — mais il empêche que les `min-w-0` disparaissent lors
 * d'un remaniement, ce qui ramènerait la panne sans que rien ne le signale.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const lire = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function fichiersDe(dossier: string): string[] {
  const out: string[] = [];
  for (const entrée of readdirSync(`${ROOT}${dossier}`)) {
    const relatif = `${dossier}/${entrée}`;
    if (statSync(`${ROOT}${relatif}`).isDirectory()) out.push(...fichiersDe(relatif));
    else if (relatif.endsWith(".tsx")) out.push(relatif);
  }
  return out;
}

export default defineSuite("Interface — rien ne déborde du cadre", (t) => {
  // =========================================================================
  // 1. LA CORRECTION DE FOND : la coque laisse la page rétrécir
  // =========================================================================
  // Sans ce `min-w-0`, un seul élément large de n'importe quelle page élargit
  // le conteneur principal — et donc l'application entière, en-tête compris.
  const shell = sansCommentaires(lire("src/components/AppShell.tsx"));
  t.check(
    "le conteneur principal a le droit de rétrécir",
    /className="min-w-0 flex-1"/.test(shell),
    true,
  );

  // =========================================================================
  // 2. Les cartes de boutique, qui portaient l'adresse insécable
  // =========================================================================
  const tableau = sansCommentaires(lire("src/routes/_authenticated/dashboard.tsx"));
  const liste = sansCommentaires(lire("src/routes/_authenticated/stores.index.tsx"));

  t.check(
    "la carte du tableau de bord peut rétrécir dans sa colonne",
    /card-elevated group min-w-0 rounded-2xl/.test(tableau),
    true,
  );
  t.check(
    "la carte de la liste peut rétrécir dans sa colonne",
    /card-elevated flex min-w-0 flex-col/.test(liste),
    true,
  );
  // `truncate` sans `min-w-0` sur le parent flexible ne tronque rien : c'est la
  // paire qui fonctionne, pas l'un des deux.
  for (const [nom, source] of [
    ["tableau de bord", tableau],
    ["liste des boutiques", liste],
  ] as const) {
    t.check(
      `${nom} : la colonne de titre autorise la troncature`,
      /className="min-w-0 flex-1"/.test(source),
      true,
    );
  }

  // =========================================================================
  // 3. Ce qui ne peut pas rétrécir doit défiler dans son propre cadre
  // =========================================================================
  // Trois onglets font 373 px : ils débordaient d'un écran de 320. Ils défilent
  // maintenant localement, sans pousser la page.
  const rapport = sansCommentaires(lire("src/routes/_authenticated/audits.$auditId.tsx"));
  t.check(
    "les onglets du rapport défilent au lieu de pousser la page",
    /<TabsList className="max-w-full overflow-x-auto">/.test(rapport),
    true,
  );
  // Même principe pour le sélecteur de boutique : une boutique de plus ne doit
  // pas casser la mise en page.
  t.check(
    "le sélecteur de boutique défile aussi",
    /role="tablist"[\s\S]{0,200}overflow-x-auto/.test(tableau),
    true,
  );

  // =========================================================================
  // 4. Les actions pleine largeur sur petit écran
  // =========================================================================
  const accueil = sansCommentaires(lire("src/routes/index.tsx"));
  // Le bouton mesurait 304 px pour 272 px disponibles à 320 px de large.
  const boutonsPleineLargeur = (
    accueil.match(/className="w-full bg-gradient-primary[^"]*sm:w-auto"/g) ?? []
  ).length;
  t.check("les deux appels à l'action tiennent dans le cadre", boutonsPleineLargeur >= 2, true);
  // L'en-tête : mot-symbole + deux actions faisaient 324 px pour 272 px.
  t.check(
    "le mot-symbole s'efface sous `sm` au profit des actions",
    /hidden font-display text-lg font-bold sm:inline/.test(accueil),
    true,
  );

  // =========================================================================
  // 5. Aucune largeur figée qui dépasserait le plus petit écran visé
  // =========================================================================
  // 320 px est la largeur de référence la plus étroite encore courante. Une
  // largeur fixe au-delà déborde par construction, quel que soit le reste.
  const ECRANS = [...fichiersDe("src/routes"), ...fichiersDe("src/components")].filter(
    (f) => !f.startsWith("src/components/ui/"),
  );
  t.check("les écrans sont bien trouvés", ECRANS.length >= 10, true);

  for (const chemin of ECRANS) {
    const source = sansCommentaires(lire(chemin));
    // `w-[420px]`, `min-w-[380px]` : des largeurs qui ne négocient pas.
    const figées = [...source.matchAll(/(?:^|\s)(?:min-)?w-\[(\d+)px\]/g)]
      .map((m) => Number(m[1]))
      .filter((px) => px > 320);
    t.check(`${chemin} : aucune largeur figée au-delà de 320 px`, figées.length, 0);
  }
});
