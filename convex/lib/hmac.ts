// HMAC-SHA256 request signing shared by both directions (Convex -> n8n, n8n -> Convex).
// Signed string: `${timestamp}.${body}`. Uses WebCrypto, available in Convex, Node 20+ and n8n.
export const MAX_SKEW_SECONDS = 300;

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`)));
}

/** Constant-time string compare (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verify(opts: {
  secret: string | undefined;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowMs?: number;
}): Promise<VerifyResult> {
  const { secret, timestamp, signature, body } = opts;
  if (!secret) return { ok: false, reason: "server secret not configured" };
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad timestamp" };
  const now = (opts.nowMs ?? Date.now()) / 1000;
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: "timestamp outside allowed window" };
  const expected = await sign(secret, timestamp, body);
  return safeEqual(expected, signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}
