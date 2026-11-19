// End-to-end checks for the Convex <-> n8n integration. Run with n8n and Convex up:
//   LENDLOOP_HMAC_SECRET=... CONVEX_SITE_URL=http://127.0.0.1:3211 node scripts/check-integration.mjs
// Optional: N8N_WEBHOOK_URL (default http://localhost:5678/webhook/lendloop-request).
// Exits non-zero if any check fails. Workflows 1 and 3 must be published for the webhook checks.
import crypto from "node:crypto";

const secret = process.env.LENDLOOP_HMAC_SECRET;
const convex = process.env.CONVEX_SITE_URL;
const webhook = process.env.N8N_WEBHOOK_URL ?? "http://localhost:5678/webhook/lendloop-request";
if (!secret || !convex) {
  console.error("Set LENDLOOP_HMAC_SECRET and CONVEX_SITE_URL");
  process.exit(2);
}

const now = () => String(Math.floor(Date.now() / 1000));
const sign = (ts, body) => crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
async function call(url, { method = "POST", body = "", ts = now(), sig } = {}) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-lendloop-timestamp": ts, "x-lendloop-signature": sig ?? sign(ts, body) },
    body: method === "GET" ? undefined : body,
  });
  return { status: res.status, text: await res.text() };
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${detail})`}`);
  if (!ok) failed++;
}

// n8n -> Convex
let r = await call(`${convex}/n8n/overdue`, { method: "GET" });
check("Convex accepts a signed GET /n8n/overdue", r.status === 200 && "loans" in JSON.parse(r.text), r.status);
r = await call(`${convex}/n8n/overdue`, { method: "GET", sig: "0".repeat(64) });
check("Convex rejects a bad signature", r.status === 401, r.status);
const stale = String(Number(now()) - 600);
r = await call(`${convex}/n8n/overdue`, { method: "GET", ts: stale, sig: sign(stale, "") });
check("Convex rejects a replayed request older than 5 minutes", r.status === 401, r.status);

// Convex -> n8n
const eventId = `check-${Date.now()}:approved`;
const good = {
  event: "approved", requestId: "check", toolName: "Test drill", recipientName: "Test", recipientEmail: "test@example.com",
  actorName: "Tester", status: "approved", startDate: "2030-01-01", endDate: "2030-01-02", eventId,
};
r = await call(webhook, { sig: "0".repeat(64), body: JSON.stringify(good) });
check("n8n rejects a forged notification", r.status === 401, r.status);
const { event: _drop, ...broken } = good; // missing "event": the workflow fails after verification
r = await call(webhook, { body: JSON.stringify(broken) });
check("n8n returns non-2xx when a run fails (so Convex retries)", r.status >= 500, r.status);
r = await call(webhook, { body: JSON.stringify(good) });
check("a retry of the failed event is delivered, not dropped as a duplicate", r.status === 200, r.status);
r = await call(webhook, { body: JSON.stringify(good) });
check("a repeat of a delivered event is acknowledged without resending", r.status === 200, r.status);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed. The failed run above should now be listed under Admin > Automation health.");
process.exit(failed ? 1 : 0);
