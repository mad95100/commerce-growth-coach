import { BASE, STORE_A, launch, makeContext } from "./harness.mjs";

const b = await launch();
const resultats = [];

// ── 1. Après un OAuth réussi : la connexion est lisible ───────────────────
{
  const ctx = await makeContext(b, {});
  const p = await ctx.newPage();
  await p.goto(`${BASE}/stores/${STORE_A}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const t = await p.locator("body").innerText();
  resultats.push(["OAuth réussi → « Connecté » affiché", /Connecté/.test(t)]);
  resultats.push([
    "OAuth réussi → le domaine est rappelé",
    /atelier-lumen\.myshopify\.com/.test(t),
  ]);
  resultats.push([
    "OAuth réussi → « Connecter Shopify » n'est plus proposé",
    !/Domaine Shopify de votre boutique/.test(t),
  ]);
  resultats.push([
    "OAuth réussi → l'audit est lançable",
    await p
      .getByRole("button", { name: /Lancer l'audit/ })
      .isVisible()
      .catch(() => false),
  ]);
  await ctx.close();
}

// ── 2. Lecture refusée : on n'invite jamais à reconnecter ─────────────────
{
  const ctx = await makeContext(b, {});
  await ctx.route(
    (u) => /rest\/v1\/data_connections/.test(u.href),
    (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "42501", message: "permission denied for column metadata" }),
      }),
  );
  const p = await ctx.newPage();
  await p.goto(`${BASE}/stores/${STORE_A}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3500);
  const t = await p.locator("body").innerText();
  resultats.push([
    "Lecture refusée → l'échec est annoncé",
    /Impossible de lire vos sources/.test(t),
  ]);
  resultats.push([
    "Lecture refusée → aucune invitation à reconnecter",
    !/Domaine Shopify de votre boutique/.test(t),
  ]);
  resultats.push([
    "Lecture refusée → il est dit que la connexion tient",
    /la connexion tient toujours/.test(t),
  ]);
  await ctx.close();
}

// ── 3. Boutique réellement sans connexion : là, on invite ─────────────────
{
  const ctx = await makeContext(b, { scenario: "sansconnexion" });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/stores/${STORE_A}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const t = await p.locator("body").innerText();
  resultats.push([
    "Sans connexion → le champ de domaine est proposé",
    /Domaine Shopify de votre boutique/.test(t),
  ]);
  resultats.push(["Sans connexion → aucun faux « Connecté »", !/Connecté\b/.test(t)]);
  await ctx.close();
}

for (const [nom, ok] of resultats) console.log(`${ok ? "  ok " : "ÉCHEC"}  ${nom}`);
console.log(resultats.every(([, ok]) => ok) ? "\nParcours conforme." : "\nDes écarts subsistent.");
await b.close();
