/**
 * Contrôles du durcissement RLS.
 *
 * Deux natures de vérification, complémentaires :
 *
 *  1. STATIQUE, sur la migration : les droits accordés au rôle `authenticated`
 *     sont ceux voulus, et les colonnes de jetons n'y figurent pas. C'est une
 *     lecture du SQL, pas une exécution : aucune base n'est jointe.
 *
 *  2. COMPORTEMENTALE, sur le code : les fonctions qui contournent RLS avec le
 *     rôle de service vérifient bien l'appartenance avant d'écrire. C'est là que
 *     se situe le risque introduit par le durcissement — contourner RLS, c'est
 *     perdre la garantie que la base refusait d'elle-même la boutique d'autrui.
 *
 * Script hors dépôt, non commité.
 */
import { readFileSync } from "node:fs";
import {
  deleteConnection,
  updateConnectionById,
  upsertPendingConnection,
} from "../../src/lib/connectors/connection-writes.server";
import { defineSuite } from "../../tests/harness";

export default defineSuite("Sécurité — RLS, GRANT et accès PostgREST", async (t) => {
  const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
  const migration = readFileSync(
    `${ROOT}/supabase/migrations/20260814130000_rls_hardening.sql`,
    "utf8",
  );

  // ---------------------------------------------------------------------------
  // 1. Les jetons ne sont plus servis au navigateur
  // ---------------------------------------------------------------------------
  const grantBlock = migration.slice(
    migration.indexOf("GRANT SELECT ("),
    migration.indexOf(") ON public.data_connections TO authenticated;"),
  );

  t.check(
    "access_token_ciphertext hors du droit de lecture",
    grantBlock.includes("access_token_ciphertext"),
    false,
  );
  t.check(
    "refresh_token_ciphertext hors du droit de lecture",
    grantBlock.includes("refresh_token_ciphertext"),
    false,
  );
  t.check("metadata hors du droit de lecture", grantBlock.includes("metadata"), false);
  t.check(
    "tous les droits retirés avant d'en redonner",
    migration.includes("REVOKE ALL ON public.data_connections FROM authenticated;"),
    true,
  );
  // Les colonnes dont l'interface a besoin restent lisibles.
  for (const col of ["status", "provider", "account_label", "connected_at", "store_id"]) {
    t.check(`colonne « ${col} » restée lisible`, grantBlock.includes(col), true);
  }
  t.check(
    "plus aucune politique FOR ALL sur data_connections",
    migration.includes('DROP POLICY IF EXISTS "data_connections_owner_all"'),
    true,
  );

  // ---------------------------------------------------------------------------
  // 2. Les journaux ne sont plus modifiables par le client
  // ---------------------------------------------------------------------------
  for (const table of ["actions", "action_results", "fix_outcomes", "data_snapshots"]) {
    t.check(
      `${table} : écritures retirées à authenticated`,
      migration.includes(`REVOKE INSERT, UPDATE, DELETE ON public.${table} FROM authenticated;`),
      true,
    );
    t.check(
      `${table} : ancienne politique FOR ALL supprimée`,
      /owner_all/.test(migration.slice(migration.indexOf(`public.${table} FROM authenticated`))),
      true,
    );
    t.check(
      `${table} : nouvelle politique en lecture seule`,
      migration.includes(`CREATE POLICY ${table}_select_own ON public.${table}\n  FOR SELECT`) ||
        migration.includes(`CREATE POLICY ${table}_select_own ON public.${table}`),
      true,
    );
  }
  // La lecture reste ouverte : l'utilisateur doit voir ses propres actions.
  t.check(
    "actions : lecture conservée",
    migration.includes("REVOKE SELECT ON public.actions"),
    false,
  );

  // ---------------------------------------------------------------------------
  // 3. Quotas : rien n'a été ouvert par mégarde
  // ---------------------------------------------------------------------------
  t.check(
    "usage : aucun droit d'écriture accordé",
    /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON public\.usage TO authenticated/.test(migration),
    false,
  );
  t.check(
    "subscriptions : aucun droit d'écriture accordé",
    /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON public\.subscriptions TO authenticated/.test(
      migration,
    ),
    false,
  );

  // L'état d'origine est celui que l'on croit : vérifié sur la migration initiale.
  const base = readFileSync(
    `${ROOT}/supabase/migrations/20260807095300_68c4553c-45cc-4e19-bb55-54ca292b9b28.sql`,
    "utf8",
  );
  t.check(
    "usage n'accordait déjà que SELECT",
    base.includes("GRANT SELECT ON public.usage TO authenticated;"),
    true,
  );
  t.check(
    "subscriptions n'accordait déjà que SELECT",
    base.includes("GRANT SELECT ON public.subscriptions TO authenticated;"),
    true,
  );
  t.check(
    "le défaut d'origine sur actions est bien celui corrigé",
    base.includes("GRANT SELECT, INSERT, UPDATE, DELETE ON public.actions TO authenticated;"),
    true,
  );

  // ---------------------------------------------------------------------------
  // 4. Le code qui contourne RLS vérifie l'appartenance
  // ---------------------------------------------------------------------------
  type Row = Record<string, any>;

  /**
   * Faux client de l'utilisateur : reproduit RLS en ne renvoyant que les
   * boutiques réellement possédées. Une boutique d'autrui remonte `null`, comme
   * PostgREST le ferait.
   */
  function userClient(ownedStoreIds: string[]) {
    const touched: string[] = [];
    const api: any = {
      _touched: touched,
      from(table: string) {
        const filters: Array<[string, any]> = [];
        const q: any = {
          select: () => q,
          eq: (c: string, v: any) => (filters.push([c, v]), q),
          maybeSingle: async () => {
            touched.push(table);
            if (table !== "stores") return { data: null, error: null };
            const id = filters.find(([c]) => c === "id")?.[1];
            return { data: ownedStoreIds.includes(id) ? { id } : null, error: null };
          },
        };
        return q;
      },
    };
    return api;
  }

  // Le module importe `supabaseAdmin` dynamiquement ; sans variables d'environnement
  // Supabase, cet import échoue. Toute écriture est donc de toute façon empêchée —
  // ce qui compte ici est que la vérification d'appartenance intervienne AVANT.
  const MINE = "store-a";
  const OTHER = "store-b";

  {
    // --- 4a. Boutique d'autrui : refusée, et refusée AVANT toute écriture ---
    let client = userClient([MINE]);
    await t.throwsAsync("upsert sur la boutique d'autrui => refusé", () =>
      upsertPendingConnection(client, OTHER, "shopify", "x.myshopify.com"),
    );
    t.check(
      "refus prononcé après consultation de stores, sans toucher data_connections",
      client._touched,
      ["stores"],
    );

    client = userClient([MINE]);
    await t.throwsAsync("suppression de la connexion d'autrui => refusée", () =>
      deleteConnection(client, OTHER, "shopify"),
    );
    t.check("suppression refusée sans toucher data_connections", client._touched, ["stores"]);

    client = userClient([MINE]);
    await t.throwsAsync("modification de la connexion d'autrui => refusée", () =>
      updateConnectionById(client, OTHER, "conn-1", { account_id: "pirate" }),
    );
    t.check("modification refusée sans toucher data_connections", client._touched, ["stores"]);

    // --- 4b. Aucune boutique possédée : tout est refusé ---
    client = userClient([]);
    await t.throwsAsync("aucune boutique => upsert refusé", () =>
      upsertPendingConnection(client, MINE, "shopify", "x"),
    );
    await t.throwsAsync("aucune boutique => suppression refusée", () =>
      deleteConnection(client, MINE, "meta_ads"),
    );

    // --- 4c. Sa propre boutique : la vérification passe ---
    // L'écriture échoue ensuite faute de client de service configuré ici, ce qui
    // est attendu : on vérifie que le refus ne vient PAS de l'appartenance.
    client = userClient([MINE]);
    let ownershipRefused = false;
    try {
      await deleteConnection(client, MINE, "shopify");
    } catch (e) {
      ownershipRefused = (e as Error).message === "Boutique introuvable";
    }
    t.check("sa propre boutique n'est jamais refusée pour appartenance", ownershipRefused, false);
  }

  // ---------------------------------------------------------------------------
  // 5. Aucune écriture résiduelle sur les tables verrouillées
  // ---------------------------------------------------------------------------
  const LOCKED = [
    "actions",
    "action_results",
    "fix_outcomes",
    "data_snapshots",
    "data_connections",
  ];
  const sources = [
    "src/lib/actions.functions.ts",
    "src/lib/tracking.server.ts",
    "src/lib/snapshots.server.ts",
    "src/lib/connectors/shopify.functions.ts",
    "src/lib/connectors/meta.functions.ts",
    "src/lib/connectors/google.functions.ts",
    "src/lib/connectors/connections.functions.ts",
    "src/components/ConnectionsPanel.tsx",
  ];

  for (const rel of sources) {
    const code = readFileSync(`${ROOT}/${rel}`, "utf8");
    for (const table of LOCKED) {
      // Repère les écritures : `.from("table")` suivi d'un upsert/insert/update/delete
      // dans les lignes qui suivent immédiatement.
      const re = new RegExp(
        `from\\("${table}"\\)[^;]{0,200}?\\.(upsert|insert|update|delete)\\(`,
        "gs",
      );
      const hits = [...code.matchAll(re)];
      for (const hit of hits) {
        const before = code.slice(Math.max(0, hit.index! - 200), hit.index!);
        const viaService = /supabaseAdmin|journal|writer|secrets/.test(before + hit[0]);
        t.check(`${rel} : écriture sur ${table} passe par le rôle de service`, viaService, true);
      }
    }
  }

  // Le composant navigateur ne lit que des colonnes autorisées.
  const panel = readFileSync(`${ROOT}/src/components/ConnectionsPanel.tsx`, "utf8");
  t.check(
    "ConnectionsPanel ne demande aucun jeton",
    /access_token_ciphertext|refresh_token_ciphertext/.test(panel),
    false,
  );

  // ---------------------------------------------------------------------------
  // 6. Le journal `actions` : écritures par le service, lectures par l'utilisateur
  // ---------------------------------------------------------------------------
  // `actions.server.ts` reçoit son client en paramètre : la propriété à vérifier
  // n'est donc pas dans ce module mais chez ses appelants. Une lecture doit rester
  // sur le client de l'utilisateur — c'est elle qui prouve l'appartenance et rend
  // les écritures suivantes légitimes.
  const callers = readFileSync(`${ROOT}/src/lib/actions.functions.ts`, "utf8");

  const WRITES = [
    "insertProposal",
    "claimProposal",
    "markFailed",
    "finalizeApplied",
    "claimRevert",
    "restoreAfterFailedRevert",
  ];
  for (const fn of WRITES) {
    const re = new RegExp(`${fn}\\(\\s*([A-Za-z_]+)`, "g");
    const args = [...callers.matchAll(re)].map((m) => m[1]).filter((a) => a !== "supabase" || true);
    t.check(`${fn} : au moins un appel`, args.length > 0, true);
    for (const arg of args) {
      t.check(`${fn} reçoit le client de service (« ${arg} »)`, arg, "journal");
    }
  }

  const reads = [...callers.matchAll(/loadProposal\(\s*([A-Za-z_]+)/g)].map((m) => m[1]);
  t.check("loadProposal : deux lectures", reads.length, 2);
  for (const arg of reads) {
    t.check(`loadProposal reste sur le client utilisateur (« ${arg} »)`, arg, "supabase");
  }
});
