import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function encryptionKey(): Buffer {
  const raw = process.env.DATA_CONNECTIONS_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_CONNECTIONS_ENCRYPTION_KEY manquant");
  // Derive a 32-byte key by hashing whatever length secret we have.
  return createHmac("sha256", "ecompilot-data-connections").update(raw).digest();
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptToken(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

function stateKey(): Buffer {
  const raw = process.env.OAUTH_STATE_SECRET;
  if (!raw) throw new Error("OAUTH_STATE_SECRET manquant");
  return createHmac("sha256", "ecompilot-oauth-state").update(raw).digest();
}

/**
 * Signs an OAuth `state` payload. The payload is opaque JSON — usually
 * `{ userId, storeId, provider, nonce, iat }`. Returned as base64url.
 */
export function signOAuthState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() }), "utf8");
  const sig = createHmac("sha256", stateKey()).update(body).digest();
  return `${body.toString("base64url")}.${sig.toString("base64url")}`;
}

export function verifyOAuthState<T extends Record<string, unknown>>(
  state: string,
  maxAgeMs = 15 * 60 * 1000,
): T {
  const [bodyB64, sigB64] = state.split(".");
  if (!bodyB64 || !sigB64) throw new Error("État OAuth invalide");
  const body = Buffer.from(bodyB64, "base64url");
  const sig = Buffer.from(sigB64, "base64url");
  const expected = createHmac("sha256", stateKey()).update(body).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    throw new Error("Signature OAuth invalide");
  }
  const parsed = JSON.parse(body.toString("utf8")) as T & { iat: number };
  if (Date.now() - parsed.iat > maxAgeMs) throw new Error("État OAuth expiré");
  return parsed;
}
