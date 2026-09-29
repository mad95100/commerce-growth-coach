/**
 * Throw-away local Postgres cluster for tests and the local stack.
 *
 * Starts Postgres 16 from the system binaries in a temporary directory, applies
 * the Supabase compatibility shim, then every migration in order. When the
 * process runs as root (containers), the server runs as the `postgres` user,
 * because Postgres refuses to run as root.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

function pgBin(name: string): string {
  for (const v of ["17", "16", "15"]) {
    const p = `/usr/lib/postgresql/${v}/bin/${name}`;
    if (existsSync(p)) return p;
  }
  return name;
}

const isRoot = process.getuid?.() === 0;

function run(cmd: string, args: string[]) {
  const full = isRoot ? ["runuser", ["-u", "postgres", "--", cmd, ...args]] : [cmd, args];
  const r = spawnSync(full[0] as string, full[1] as string[], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

export interface Cluster {
  port: number;
  dir: string;
  url: string; // superuser connection string
  stop: () => void;
}

export function startCluster(port = 54000 + Math.floor(Math.random() * 900)): Cluster {
  const dir = mkdtempSync(join(tmpdir(), "bsg-pg-"));
  chmodSync(dir, 0o777);
  const data = join(dir, "data");
  if (isRoot) execFileSync("chown", ["postgres", dir]);
  run(pgBin("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C.UTF-8"]);
  run(pgBin("pg_ctl"), [
    "-D", data, "-l", join(dir, "log.txt"), "-w",
    "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
    "start",
  ]);
  const stop = () => {
    try {
      run(pgBin("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
    } catch {
      /* already stopped */
    }
    rmSync(dir, { recursive: true, force: true });
  };
  return { port, dir, url: `postgres://postgres@127.0.0.1:${port}/postgres`, stop };
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function applySchema(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(readFileSync(join(ROOT, "dev", "supabase-shim.sql"), "utf8"));
    for (const f of migrationFiles()) {
      try {
        await client.query(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
      } catch (e) {
        const err = e as { message: string; position?: string };
        const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
        const pos = Number(err.position ?? 0);
        const line = pos ? sql.slice(0, pos).split("\n").length : 0;
        throw new Error(`${f}${line ? `:${line}` : ""} — ${err.message}`);
      }
    }
  } finally {
    await client.end();
  }
}
