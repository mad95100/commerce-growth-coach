import pg from "pg";
import { applySchema, startCluster, type Cluster } from "../../dev/pg.ts";

// numeric → JS number (amounts have 2 decimals: exact enough as numbers).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export interface Db {
  cluster: Cluster;
  admin: pg.Client;
  createUser: (email: string) => Promise<string>;
  as: <T = Record<string, unknown>>(userId: string | null, sql: string, params?: unknown[]) => Promise<T[]>;
  rpc: <T = unknown>(userId: string | null, fn: string, args: Record<string, unknown>) => Promise<T>;
  close: () => Promise<void>;
}

export async function startDb(): Promise<Db> {
  const cluster = startCluster();
  await applySchema(cluster.url);
  const admin = new pg.Client({ connectionString: cluster.url });
  await admin.connect();
  const user = new pg.Client({ connectionString: cluster.url });
  await user.connect();

  async function as<T>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    await user.query("begin");
    try {
      if (userId) {
        await user.query("set local role authenticated");
        await user.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: userId, role: "authenticated" }),
        ]);
      } else {
        await user.query("set local role anon");
      }
      const r = await user.query(sql, params);
      await user.query("commit");
      return r.rows as T[];
    } catch (e) {
      await user.query("rollback");
      throw e;
    }
  }

  async function rpc<T>(userId: string | null, fn: string, args: Record<string, unknown>): Promise<T> {
    const names = Object.keys(args);
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
    const values = names.map((n) => {
      const v = args[n];
      return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    });
    const rows = await as<{ r: T }>(userId, sql, values);
    return rows[0].r;
  }

  async function createUser(email: string): Promise<string> {
    const r = await admin.query("insert into auth.users(email) values ($1) returning id", [email]);
    return r.rows[0].id;
  }

  return {
    cluster,
    admin,
    createUser,
    as,
    rpc,
    close: async () => {
      await user.end();
      await admin.end();
      cluster.stop();
    },
  };
}

/** Asserts that a promise rejects with a `bsg.<code>` message. */
export async function rejects(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === code || msg.includes(code)) return;
    throw new Error(`expected ${code}, got: ${msg}`);
  }
  throw new Error(`expected ${code}, but it succeeded`);
}
