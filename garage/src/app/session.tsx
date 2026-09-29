/**
 * Who is signed in, which garage they are working in, what their role allows,
 * and which branch is selected. Permissions come from the database table
 * `role_permissions`, the same one the database enforces.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase.ts";
import type { Branch, Membership, Org, PaymentMethod, TaxRate, Technician } from "@/api/types.ts";

const ORG_KEY = "bsg-org";
const BRANCH_KEY = "bsg-branch";

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

type Status = "loading" | "signed_out" | "no_org" | "ready" | "error";

interface SessionValue {
  status: Status;
  error: unknown;
  user: User | null;
  memberships: Array<Membership & { organizations: Org }>;
  org: Org | null;
  role: string | null;
  displayName: string;
  can: (perm: string) => boolean;
  branchId: string | null; // null = all branches
  setBranchId: (id: string | null) => void;
  switchOrg: (id: string) => void;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(readLocal(ORG_KEY));
  const [branchId, setBranch] = useState<string | null>(readLocal(BRANCH_KEY));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const membershipsQ = useQuery({
    queryKey: ["session", "memberships", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Joining a garage that invited this email happens here, silently.
      await supabase.rpc("accept_invitations");
      const { data, error } = await supabase
        .from("memberships")
        .select("org_id, user_id, role, display_name, email, active, organizations(*)")
        .eq("user_id", user!.id)
        .eq("active", true);
      if (error) throw error;
      return (data ?? []).filter((m) => m.organizations) as unknown as Array<Membership & { organizations: Org }>;
    },
  });

  const memberships = useMemo(() => membershipsQ.data ?? [], [membershipsQ.data]);
  const current = memberships.find((m) => m.org_id === orgId) ?? memberships[0] ?? null;

  const permsQ = useQuery({
    queryKey: ["session", "perms", current?.role],
    enabled: !!current,
    queryFn: async () => {
      const { data, error } = await supabase.from("role_permissions").select("permission").eq("role", current!.role);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.permission as string));
    },
    staleTime: Infinity,
  });

  let status: Status;
  if (!authReady) status = "loading";
  else if (!user) status = "signed_out";
  else if (membershipsQ.isError || permsQ.isError) status = "error";
  else if (membershipsQ.isPending) status = "loading";
  else if (!current) status = "no_org";
  else if (permsQ.isPending) status = "loading";
  else status = "ready";

  const perms = permsQ.data;
  const can = useCallback((p: string) => !!perms?.has(p), [perms]);

  const value: SessionValue = {
    status,
    error: membershipsQ.error ?? permsQ.error,
    user,
    memberships,
    org: current?.organizations ?? null,
    role: current?.role ?? null,
    displayName: current?.display_name || user?.email || "",
    can,
    branchId,
    setBranchId: (id) => {
      writeLocal(BRANCH_KEY, id);
      setBranch(id);
    },
    switchOrg: (id) => {
      writeLocal(ORG_KEY, id);
      writeLocal(BRANCH_KEY, null);
      setBranch(null);
      setOrgId(id);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    },
    reload: async () => {
      await qc.invalidateQueries({ queryKey: ["session"] });
    },
    signOut: async () => {
      await supabase.auth.signOut();
      qc.clear();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** The garage currently in use. Only call inside the signed-in area. */
export function useOrg(): Org {
  const { org } = useSession();
  if (!org) throw new Error("useOrg without organization");
  return org;
}

export interface RefData {
  branches: Branch[];
  taxRates: TaxRate[];
  methods: PaymentMethod[];
  technicians: Technician[];
  defaultTaxRate: TaxRate | null;
}

/** Reference data used across screens: branches, VAT rates, payment methods, technicians. */
export function useRefData() {
  const { org } = useSession();
  return useQuery({
    queryKey: ["ref", org?.id],
    enabled: !!org,
    queryFn: async (): Promise<RefData> => {
      const [b, tr, pm, te] = await Promise.all([
        supabase.from("branches").select("*").eq("org_id", org!.id).order("is_default", { ascending: false }).order("name"),
        supabase.from("tax_rates").select("*").eq("org_id", org!.id).order("rate", { ascending: false }),
        supabase.from("payment_methods").select("*").eq("org_id", org!.id).order("sort_order"),
        supabase.from("technicians").select("*").eq("org_id", org!.id).order("name"),
      ]);
      for (const r of [b, tr, pm, te]) if (r.error) throw r.error;
      const taxRates = (tr.data ?? []) as TaxRate[];
      return {
        branches: (b.data ?? []) as Branch[],
        taxRates,
        methods: (pm.data ?? []) as PaymentMethod[],
        technicians: (te.data ?? []) as Technician[],
        defaultTaxRate: taxRates.find((x) => x.is_default) ?? null,
      };
    },
  });
}
