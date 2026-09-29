/**
 * End-to-end test: the whole garage journey in a real browser (Chromium),
 * against the real database schema (local Postgres + PostgREST + auth
 * stand-in). Then responsive checks at phone, tablet and desktop widths,
 * Arabic RTL, permissions, error and empty states.
 *
 *   npm run test:e2e              starts its own stack and Vite server
 *   E2E_BASE=http://127.0.0.1:5173 npm run test:e2e   reuses running ones
 *
 * Screenshots go to test-results/.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startStack, type Stack } from "../../dev/stack.ts";
import { journey } from "./journey.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = `${ROOT}test-results`;
mkdirSync(OUT, { recursive: true });

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Containers often have Playwright installed globally only.
    const require = createRequire(import.meta.url);
    return require("/opt/node22/lib/node_modules/playwright") as typeof import("playwright");
  }
}

async function waitHttp(url: string, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${url}`);
}

let stack: Stack | null = null;
let vite: ChildProcess | null = null;
let base = process.env.E2E_BASE;
let code = 0;
try {
  if (!base) {
    stack = await startStack({ gatewayPort: 55321, dbPort: 55322, pgrstPort: 55330, writeEnv: false });
    vite = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5174", "--strictPort"], {
      cwd: ROOT,
      env: { ...process.env, VITE_SUPABASE_URL: stack.url, VITE_SUPABASE_ANON_KEY: stack.anonKey, VITE_CACHE_DIR: "node_modules/.vite-e2e" },
      stdio: ["ignore", "ignore", "inherit"],
    });
    base = "http://127.0.0.1:5174";
    await waitHttp(`${base}/`);
  }
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  try {
    code = await journey(browser, base, OUT);
  } finally {
    await browser.close();
  }
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  vite?.kill("SIGTERM");
  await stack?.stop();
}
process.exit(code);
