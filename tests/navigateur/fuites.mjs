import { BASE, STORE_A, AUDIT_1, launch, makeContext } from "./harness.mjs";

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
  ["404", "/page-inexistante"],
];

// Motifs qui ne devraient JAMAIS atteindre le marchand.
const FUITES = [
  [/\bundefined\b/, "undefined"],
  [/\bNaN\b/, "NaN"],
  [/\[object Object\]/, "[object Object]"],
  [/\bInfinity\b/, "Infinity"],
  // Ponctuation orpheline. En français, « : » et « ; » prennent LÉGITIMEMENT
  // une espace avant : les inclure ferait crier ce contrôle sur chaque phrase
  // correcte, et un contrôle qui crie faux finit ignoré puis supprimé. Seuls le
  // point et la virgule sont fautifs précédés d'une espace.
  [/\s[.,](\s|$)/m, "ponctuation orpheline"],
  [/«\s*»/, "guillemets vides"],
  [/\(\s*\)/, "parenthèses vides"],
];

const browser = await launch();
const problemes = [];
for (const scenario of ["normal", "vide"]) {
  const ctx = await makeContext(browser, { scenario });
  const page = await ctx.newPage();
  for (const [nom, chemin] of ROUTES) {
    try {
      await page.goto(BASE + chemin, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1800);
      const texte = await page.locator("body").innerText();
      for (const [motif, label] of FUITES) {
        const m = texte.match(motif);
        if (m) {
          const i = texte.indexOf(m[0]);
          problemes.push(
            `${scenario}/${nom} : ${label} → « …${texte.slice(Math.max(0, i - 60), i + 40).replace(/\n/g, " ")}… »`,
          );
        }
      }
    } catch (e) {
      problemes.push(`${scenario}/${nom} : ÉCHEC ${String(e).slice(0, 80)}`);
    }
  }
  await ctx.close();
}
console.log(problemes.length ? problemes.join("\n") : "Aucune valeur brute rendue au marchand.");
await browser.close();
