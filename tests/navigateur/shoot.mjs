import { BASE, STORE_A, AUDIT_1, launch, makeContext } from "./harness.mjs";
import { mkdirSync } from "node:fs";

const OUT = process.env.SHOTS_DIR ?? new URL("./captures/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const routes = [
  ["accueil", "/"],
  ["auth", "/auth"],
  ["onboarding", "/onboarding"],
  ["dashboard", "/dashboard"],
  ["boutiques", "/stores"],
  ["boutique", `/stores/${STORE_A}`],
  ["rapport", `/audits/${AUDIT_1}`],
  ["parametres", "/settings"],
  ["suivi", `/tracking/${STORE_A}`],
  ["404", "/page-qui-nexiste-pas"],
];

const only = process.argv[2];
const scenario = process.argv[3] || "normal";
const browser = await launch();
const log = [];

for (const mobile of [false, true]) {
  const ctx = await makeContext(browser, { scenario, mobile });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => errs.push("PAGEERR " + String(e).slice(0, 160)));

  for (const [nom, path] of routes) {
    if (only && only !== "all" && only !== nom) continue;
    errs.length = 0;
    const suffix = mobile ? "mobile" : "desktop";
    try {
      await page.goto(BASE + path, {
        waitUntil: scenario === "lent" ? "commit" : "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(scenario === "lent" ? 900 : 2200);
      await page.screenshot({
        path: `${OUT}${nom}-${suffix}${scenario === "normal" ? "" : "-" + scenario}.png`,
        fullPage: true,
      });
      log.push(`${suffix.padEnd(7)} ${nom.padEnd(12)} → ${page.url().replace(BASE, "")}`);
      if (errs.length) log.push(`         ⚠ ${[...new Set(errs)].slice(0, 3).join(" | ")}`);
    } catch (e) {
      log.push(`${suffix.padEnd(7)} ${nom.padEnd(12)} ÉCHEC ${String(e).slice(0, 120)}`);
    }
  }
  await ctx.close();
}

console.log(log.join("\n"));
await browser.close();
