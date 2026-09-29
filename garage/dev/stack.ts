/**
 * Local stack for development and end-to-end tests — NOT used in production.
 *
 *   Postgres 16 (throw-away cluster, all migrations applied)
 *   PostgREST   (the same REST engine Supabase runs)
 *   Gateway     on http://127.0.0.1:54321 — the Supabase URL shape:
 *                 /rest/v1/*  → PostgREST
 *                 /auth/v1/*  → a minimal stand-in for Supabase Auth
 *                              (email + password, JWT HS256, refresh tokens)
 *
 * The auth stand-in implements only what the app uses: sign-up (auto-
 * confirmed), password sign-in, refresh, user, sign-out. Production uses
 * Supabase Auth itself; nothing here ships.
 *
 * Run: npm run stack   (prints the env for Vite and keeps running)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applySchema, startCluster } from "./pg.ts";
import { signJwt, verifyJwt } from "./jwt.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STACK_DIR = join(ROOT, ".stack");
const JWT_SECRET = "local-dev-only-secret-at-least-32-characters-long";

export interface Stack {
  url: string;
  anonKey: string;
  dbUrl: string;
  stop: () => Promise<void>;
}

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
function checkPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const got = scryptSync(pw, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(got, Buffer.from(hash, "hex"));
}

async function waitFor(url: string, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for ${url}`);
}

export async function startStack(opts: { gatewayPort?: number; dbPort?: number; pgrstPort?: number; writeEnv?: boolean } = {}): Promise<Stack> {
  const gatewayPort = opts.gatewayPort ?? 54321;
  const pgrstPort = opts.pgrstPort ?? 54330;
  const cluster = startCluster(opts.dbPort ?? 54322);
  await applySchema(cluster.url);
  const db = new pg.Client({ connectionString: cluster.url });
  await db.connect();

  const bin = join(STACK_DIR, "bin", "postgrest");
  if (!existsSync(bin)) {
    throw new Error(
      "PostgREST binary missing. Download it once:\n" +
        "  mkdir -p .stack/bin && cd .stack/bin && curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ",
    );
  }
  const pgrst: ChildProcess = spawn(bin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator:authenticator@127.0.0.1:${cluster.port}/postgres`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(pgrstPort),
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_LOG_LEVEL: "error",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitFor(`http://127.0.0.1:${pgrstPort}/`);

  const anonKey = signJwt({ role: "anon", iss: "bsg-local", iat: 1_700_000_000, exp: 2_000_000_000 }, JWT_SECRET);
  const refreshTokens = new Map<string, string>(); // token → user id

  async function userRow(id: string) {
    const r = await db.query("select id, email, raw_user_meta_data, created_at, updated_at from auth.users where id = $1", [id]);
    return r.rows[0];
  }
  function userJson(u: { id: string; email: string; raw_user_meta_data: unknown; created_at: Date; updated_at: Date }) {
    return {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      email_confirmed_at: u.created_at,
      phone: "",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: u.raw_user_meta_data ?? {},
      identities: [],
      created_at: u.created_at,
      updated_at: u.updated_at,
    };
  }
  async function session(id: string) {
    const u = await userRow(id);
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600;
    const access = signJwt(
      { sub: id, role: "authenticated", aud: "authenticated", email: u.email, iat: now, exp: now + expiresIn, session_id: randomUUID() },
      JWT_SECRET,
    );
    const refresh = randomBytes(24).toString("hex");
    refreshTokens.set(refresh, id);
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: expiresIn,
      expires_at: now + expiresIn,
      refresh_token: refresh,
      user: userJson(u),
    };
  }

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile, x-supabase-api-version, x-retry-count",
    "access-control-expose-headers": "content-range, content-location, x-supabase-api-version",
  };

  function send(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { ...cors, "content-type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  }
  const authError = (res: http.ServerResponse, status: number, code: string, msg: string) =>
    send(res, status, { code: status, error_code: code, msg, error: code, error_description: msg });

  async function readBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        return res.end();
      }
      if (url.pathname.startsWith("/rest/v1")) {
        const body = await readBody(req);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string" && !["host", "connection", "content-length", "apikey"].includes(k)) headers[k] = v;
        }
        if (!headers.authorization) headers.authorization = `Bearer ${anonKey}`;
        const r = await fetch(`http://127.0.0.1:${pgrstPort}${url.pathname.slice("/rest/v1".length) || "/"}${url.search}`, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : new Uint8Array(body),
        });
        const out = Buffer.from(await r.arrayBuffer());
        const h: Record<string, string> = { ...cors };
        r.headers.forEach((v, k) => {
          if (!["content-encoding", "transfer-encoding", "connection", "content-length"].includes(k)) h[k] = v;
        });
        res.writeHead(r.status, h);
        return res.end(out);
      }
      if (url.pathname.startsWith("/auth/v1")) {
        const path = url.pathname.slice("/auth/v1".length);
        const json = req.method === "POST" ? JSON.parse((await readBody(req)).toString("utf8") || "{}") : {};
        if (path === "/signup" && req.method === "POST") {
          const email = String(json.email ?? "").trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return authError(res, 400, "validation_failed", "Unable to validate email address: invalid format");
          if (String(json.password ?? "").length < 6) return authError(res, 422, "weak_password", "Password should be at least 6 characters.");
          const exists = await db.query("select 1 from auth.users where lower(email) = $1", [email]);
          if (exists.rowCount) return authError(res, 422, "user_already_exists", "User already registered");
          const r = await db.query(
            "insert into auth.users(email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning id",
            [email, hashPassword(String(json.password)), JSON.stringify(json.data ?? {})],
          );
          return send(res, 200, await session(r.rows[0].id));
        }
        if (path === "/token" && req.method === "POST") {
          const grant = url.searchParams.get("grant_type");
          if (grant === "password") {
            const r = await db.query("select id, encrypted_password from auth.users where lower(email) = $1", [
              String(json.email ?? "").trim().toLowerCase(),
            ]);
            if (!r.rowCount || !checkPassword(String(json.password ?? ""), r.rows[0].encrypted_password)) {
              return authError(res, 400, "invalid_credentials", "Invalid login credentials");
            }
            return send(res, 200, await session(r.rows[0].id));
          }
          if (grant === "refresh_token") {
            const id = refreshTokens.get(String(json.refresh_token ?? ""));
            if (!id) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
            refreshTokens.delete(String(json.refresh_token));
            return send(res, 200, await session(id));
          }
          return authError(res, 400, "unsupported_grant_type", "unsupported grant type");
        }
        const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        const claims = verifyJwt(token, JWT_SECRET);
        if (path === "/user" && req.method === "GET") {
          if (!claims?.sub) return authError(res, 401, "bad_jwt", "invalid JWT");
          const u = await userRow(String(claims.sub));
          if (!u) return authError(res, 404, "user_not_found", "User not found");
          return send(res, 200, userJson(u));
        }
        if (path === "/logout" && req.method === "POST") {
          res.writeHead(204, cors);
          return res.end();
        }
        if (path === "/settings") return send(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true });
        return authError(res, 404, "not_found", `Not implemented in the local stand-in: ${path}`);
      }
      send(res, 404, { message: "not found" });
    } catch (e) {
      send(res, 500, { message: (e as Error).message });
    }
  });
  await new Promise<void>((r) => server.listen(gatewayPort, "127.0.0.1", r));

  const url = `http://127.0.0.1:${gatewayPort}`;
  if (opts.writeEnv !== false) {
    mkdirSync(STACK_DIR, { recursive: true });
    writeFileSync(join(STACK_DIR, ".env.local"), `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${anonKey}\n`);
  }

  return {
    url,
    anonKey,
    dbUrl: cluster.url,
    stop: async () => {
      server.close();
      pgrst.kill("SIGTERM");
      await db.end().catch(() => {});
      cluster.stop();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stack = await startStack();
  console.log(`Local stack ready.\n  VITE_SUPABASE_URL=${stack.url}\n  VITE_SUPABASE_ANON_KEY=${stack.anonKey}\n  database: ${stack.dbUrl}\n(env written to .stack/.env.local — Ctrl+C to stop)`);
  const stop = async () => {
    await stack.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
