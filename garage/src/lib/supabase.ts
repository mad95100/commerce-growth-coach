import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when the build has no backend configured (shown as a setup screen). */
export const backendMissing = !url || !key;

export const supabase = createClient(url ?? "http://invalid.local", key ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "bsg-auth" },
});

/** Unwraps a supabase-js result: returns data or throws the error object. */
export async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
