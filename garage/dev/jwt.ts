import { createHmac } from "node:crypto";

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const [h, b, s] = token.split(".");
  if (!h || !b || !s) return null;
  const expected = b64url(createHmac("sha256", secret).update(`${h}.${b}`).digest());
  if (expected !== s) return null;
  const payload = JSON.parse(Buffer.from(b.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
  return payload;
}
