import { BASE, STORE_A, AUDIT_1, launch, makeContext } from "./harness.mjs";

const ROUTES = [
  ["accueil", "/"],
  ["onboarding", "/onboarding"],
  ["dashboard", "/dashboard"],
  ["boutiques", "/stores"],
  ["boutique", `/stores/${STORE_A}`],
  ["rapport", `/audits/${AUDIT_1}`],
  ["parametres", "/settings"],
  ["suivi", `/tracking/${STORE_A}`],
];

const browser = await launch();
const ctx = await makeContext(browser, {});
const page = await ctx.newPage();
const problemes = [];

for (const [nom, chemin] of ROUTES) {
  await page.goto(BASE + chemin, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const out = {
      sansNom: [],
      champsSansEtiquette: [],
      titres: [],
      langue: null,
      focusInvisible: [],
    };

    // Boutons et liens sans nom accessible : un lecteur d'écran annonce
    // « bouton », sans dire lequel.
    for (const el of document.querySelectorAll("button, a[href], [role='button']")) {
      const nom = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.textContent ||
        ""
      ).trim();
      if (!nom) {
        out.sansNom.push(
          `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 50)}`,
        );
      }
    }

    // Champs de saisie sans étiquette reliée.
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (el.type === "hidden") continue;
      const id = el.id;
      const etiquette =
        (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
        el.closest("label") ||
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby");
      if (!etiquette) {
        out.champsSansEtiquette.push(
          `${el.tagName.toLowerCase()}#${id || "(sans id)"}[${el.type || ""}]`,
        );
      }
    }

    // Ordre des titres : un saut (h1 → h3) casse la navigation par titres.
    for (const h of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      out.titres.push(Number(h.tagName[1]));
    }

    out.langue = document.documentElement.getAttribute("lang");
    return out;
  });

  if (r.sansNom.length)
    problemes.push(
      `${nom} : ${r.sansNom.length} contrôle(s) sans nom accessible\n      ${r.sansNom.slice(0, 4).join("\n      ")}`,
    );
  if (r.champsSansEtiquette.length)
    problemes.push(
      `${nom} : champ(s) sans étiquette\n      ${r.champsSansEtiquette.join("\n      ")}`,
    );
  if (r.langue !== "fr")
    problemes.push(`${nom} : langue du document = ${JSON.stringify(r.langue)} (attendu "fr")`);

  const niveaux = r.titres;
  if (niveaux.length && niveaux[0] !== 1)
    problemes.push(`${nom} : le premier titre est h${niveaux[0]}, pas h1`);
  const nbH1 = niveaux.filter((n) => n === 1).length;
  if (nbH1 !== 1) problemes.push(`${nom} : ${nbH1} titre(s) h1 (attendu exactement 1)`);
  for (let i = 1; i < niveaux.length; i++) {
    if (niveaux[i] - niveaux[i - 1] > 1) {
      problemes.push(`${nom} : saut de titre h${niveaux[i - 1]} → h${niveaux[i]}`);
      break;
    }
  }

  // Le focus doit se voir : on tabule et on regarde si le style change.
  const focus = await page.evaluate(() => {
    const cibles = [...document.querySelectorAll("button, a[href], input, textarea")].slice(0, 6);
    const invisibles = [];
    for (const el of cibles) {
      el.focus();
      const s = getComputedStyle(el);
      const aUnAnneau =
        (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) ||
        s.boxShadow !== "none" ||
        s.getPropertyValue("--tw-ring-shadow");
      if (!aUnAnneau)
        invisibles.push(
          `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 40)}`,
        );
    }
    return invisibles;
  });
  if (focus.length)
    problemes.push(
      `${nom} : ${focus.length} élément(s) sans marque de focus visible\n      ${focus.slice(0, 3).join("\n      ")}`,
    );
}

console.log(problemes.length ? problemes.join("\n") : "Aucun problème d'accessibilité relevé.");
await browser.close();
