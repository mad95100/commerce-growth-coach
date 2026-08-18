/**
 * UNE SEULE LECTURE TOMBE, AU MILIEU D'UN ÉCRAN PAR AILLEURS COMPLET.
 *
 * C'est la forme réelle du défaut qui a produit la boucle « Connectez Shopify » :
 * la colonne `metadata` refusée sur `data_connections` n'a jamais empêché la
 * lecture des boutiques. L'écran s'affichait entier, correct partout — sauf à
 * l'endroit précis qui affirmait le contraire de la vérité.
 *
 * Ce script rend l'application réelle et vérifie que chacun des trois replis
 * muets corrigés se DIT désormais à l'écran. Il ne prouve rien sur la
 * production : le backend est simulé ici, l'égress étant fermé.
 */
import { AUDIT_1, BASE, STORE_A, launch, makeContext } from "./harness.mjs";

const b = await launch();
let échecs = 0;
const dire = (nom, ok) => {
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${nom}`);
  if (!ok) échecs++;
};

// ---------------------------------------------------------------------------
// 1. Les constats illisibles : le rapport ne délivre pas un certificat vide
// ---------------------------------------------------------------------------
{
  const ctx = await makeContext(b, { tablesEnPanne: ["audit_findings"] });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/audits/${AUDIT_1}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const t = await p.locator("body").innerText();

  dire("constats : l'échec de lecture est annoncé", /Impossible d'afficher les constats/.test(t));
  dire("constats : on dit que l'audit a bien abouti", /ses conclusions sont enregistrées/.test(t));
  dire(
    "constats : on interdit de conclure « rien trouvé »",
    /Ne concluez pas que rien n'a été trouvé/.test(t),
  );
  dire("constats : aucun « Problèmes (0) » affiché", !/Problèmes \(0\)/.test(t));
  // `innerText` rend le texte TEL QU'AFFICHÉ : le titre passe par un
  // `text-transform: uppercase`, d'où la comparaison insensible à la casse.
  dire("constats : le rapport reste lisible par ailleurs", /score global/i.test(t));
  dire("constats : le score et le verdict restent affichés", /58/.test(t) && /tunnel/i.test(t));
  // Le gain estimé se calcule à partir des constats : à zéro, il ne doit pas
  // s'afficher — « 0 € de potentiel » serait la même fausse affirmation.
  dire("constats : aucun gain estimé n'est affiché", !/\/mois/.test(t));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 2. L'historique des corrections illisible : on prévient avant de réécrire
// ---------------------------------------------------------------------------
{
  const ctx = await makeContext(b, { fonctionsEnPanne: ["listActions"] });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/audits/${AUDIT_1}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const t = await p.locator("body").innerText();

  dire(
    "corrections : l'ignorance est dite",
    /Nous n'avons pas pu lire ce qui a déjà été appliqué/.test(t),
  );
  dire(
    "corrections : le marchand est prévenu du risque de doublon",
    /vérifiez dans votre compte qu'elle n'a pas déjà été appliquée/.test(t),
  );
  dire("corrections : les constats restent affichés", /Problèmes \(3\)/.test(t));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 3. Le suivi illisible : ce n'est pas « aucune correction suivie »
// ---------------------------------------------------------------------------
{
  const ctx = await makeContext(b, { fonctionsEnPanne: ["getStoreTracking"] });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/tracking/${STORE_A}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const t = await p.locator("body").innerText();

  dire("suivi : l'échec de lecture est annoncé", /Impossible d'afficher le suivi/.test(t));
  dire("suivi : les mesures sont dites intactes", /ne sont pas perdues/.test(t));
  dire(
    "suivi : aucune affirmation « aucune correction suivie »",
    !/Aucune correction suivie|aucune correction n'est encore suivie/i.test(t),
  );
  // Le bouton de remesure dépendait du NOMBRE de corrections : à zéro, il
  // devenait invisible. Sur un échec de lecture, le marchand se retrouvait donc
  // sans page ET sans action.
  const remesure = p.getByRole("button", { name: /remesurer/i });
  dire("suivi : le bouton de remesure reste atteignable", await remesure.isVisible());
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 4. LE DÉFAUT D'ORIGINE : les sources de données illisibles
// ---------------------------------------------------------------------------
// C'est exactement ce que produisait la colonne `metadata` non accordée : la
// page boutique s'affichait entière, et le seul panneau faux était celui qui
// réclamait de reconnecter une boutique déjà connectée.
{
  const ctx = await makeContext(b, { tablesEnPanne: ["data_connections"] });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/stores/${STORE_A}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const t = await p.locator("body").innerText();

  dire("sources : l'échec de lecture est annoncé", /Impossible de lire vos sources/i.test(t));
  dire("sources : la connexion est dite intacte", /la connexion tient toujours/i.test(t));
  dire("sources : la boutique reste lisible", /atelier lumen/i.test(t));
  await ctx.close();
}

await b.close();
console.log(échecs === 0 ? "\nTout est conforme." : `\n${échecs} contrôle(s) en échec.`);
process.exit(échecs === 0 ? 0 : 1);
