import { BASE, STORE_A, AUDIT_1, launch, makeContext } from "./harness.mjs";

const LARGEURS = [320, 375, 414, 768, 1024, 1440];
const ROUTES = [
  ["accueil", "/"],
  ["auth", "/auth"],
  ["onboarding", "/onboarding"],
  ["dashboard", "/dashboard"],
  ["boutiques", "/stores"],
  ["boutique", `/stores/${STORE_A}`],
  ["rapport", `/audits/${AUDIT_1}`],
  ["parametres", "/settings"],
  ["suivi", `/tracking/${STORE_A}`],
];

const browser = await launch();
const problemes = [];

// Contexte unique par largeur, en réutilisant le harnais (session + fixtures).
for (const largeur of LARGEURS) {
  const ctx = await makeContext(browser, { mobile: largeur < 768 });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: largeur, height: 900 });

  for (const [nom, chemin] of ROUTES) {
    try {
      await page.goto(BASE + chemin, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1200);

      const rapport = await page.evaluate((vw) => {
        const doc = document.documentElement;
        const debordePage = doc.scrollWidth > vw + 1;
        // Les éléments qui dépassent réellement du cadre visible, en ignorant
        // ceux qui défilent volontairement dans leur propre conteneur.
        const coupables = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right <= vw + 1 && r.left >= -1) continue;
          let parent = el.parentElement;
          let dansUnDefilement = false;
          while (parent) {
            const ov = getComputedStyle(parent).overflowX;
            if (ov === "auto" || ov === "scroll") {
              dansUnDefilement = true;
              break;
            }
            parent = parent.parentElement;
          }
          if (dansUnDefilement) continue;
          // Un ANCÊTRE fixe suffit : la barre de navigation basse est ancrée au
          // cadre, ses liens ne participent pas à la largeur du document.
          let p2 = el;
          let sousUnAncrage = false;
          while (p2) {
            if (getComputedStyle(p2).position === "fixed") {
              sousUnAncrage = true;
              break;
            }
            p2 = p2.parentElement;
          }
          if (sousUnAncrage) continue;
          coupables.push({
            balise: el.tagName.toLowerCase(),
            classe: (el.className || "").toString().slice(0, 70),
            gauche: Math.round(r.left),
            droite: Math.round(r.right),
            texte: (el.textContent || "").trim().slice(0, 40),
          });
        }
        // Ne garder que les plus PROFONDS : un parent déborde parce que son
        // enfant déborde, et lister les deux noie le vrai responsable.
        return { debordePage, largeurDoc: doc.scrollWidth, coupables: coupables.slice(-4) };
      }, largeur);

      if (rapport.debordePage) {
        problemes.push(
          `${largeur}px ${nom} : document ${rapport.largeurDoc}px > ${largeur}px\n` +
            rapport.coupables
              .map((c) => `      ${c.balise}.${c.classe} [${c.gauche}→${c.droite}] « ${c.texte} »`)
              .join("\n"),
        );
      }
    } catch (e) {
      problemes.push(`${largeur}px ${nom} : ÉCHEC ${String(e).slice(0, 90)}`);
    }
  }
  await ctx.close();
}

console.log(problemes.length ? problemes.join("\n") : "Aucun débordement horizontal.");
await browser.close();
