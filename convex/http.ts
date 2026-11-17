import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verify } from "./lib/hmac";
import { ISO_DATE } from "./lib/rbac";

const http = httpRouter();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** n8n -> Convex: every request is HMAC-signed over `${timestamp}.${rawBody}` (empty body for GET). */
async function authenticate(req: Request): Promise<{ ok: true; body: string } | { ok: false; res: Response }> {
  const body = req.method === "GET" ? "" : await req.text();
  const r = await verify({
    secret: process.env.LENDLOOP_HMAC_SECRET,
    timestamp: req.headers.get("x-lendloop-timestamp"),
    signature: req.headers.get("x-lendloop-signature"),
    body,
  });
  if (!r.ok) return { ok: false, res: json({ error: "unauthorized" }, 401) }; // reason deliberately not echoed
  return { ok: true, body };
}

http.route({
  path: "/n8n/overdue",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const a = await authenticate(req);
    if (!a.ok) return a.res;
    const loans = await ctx.runMutation(internal.requests.overdueLoans, {});
    return json({ loans });
  }),
});

http.route({
  path: "/n8n/reminder-sent",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const a = await authenticate(req);
    if (!a.ok) return a.res;
    let p: { requestId?: string; sentOn?: string; idempotencyKey?: string };
    try {
      p = JSON.parse(a.body);
    } catch {
      return json({ error: "bad json" }, 400);
    }
    if (!p.requestId || !p.sentOn || !ISO_DATE.test(p.sentOn) || !p.idempotencyKey || p.idempotencyKey.length > 100) {
      return json({ error: "invalid payload" }, 400);
    }
    const result = await ctx.runMutation(internal.requests.recordReminder, {
      requestId: p.requestId as Id<"borrowRequests">,
      sentOn: p.sentOn,
      idempotencyKey: p.idempotencyKey,
    });
    return json(result);
  }),
});

/** Called by the n8n error workflow so failed runs show up in the app's activity log. */
http.route({
  path: "/n8n/automation-failure",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const a = await authenticate(req);
    if (!a.ok) return a.res;
    let p: { workflow?: string; message?: string };
    try {
      p = JSON.parse(a.body);
    } catch {
      return json({ error: "bad json" }, 400);
    }
    await ctx.runMutation(internal.requests.logActivity, {
      type: "automation_failure",
      summary: `n8n workflow "${String(p.workflow ?? "unknown").slice(0, 80)}" failed: ${String(p.message ?? "").slice(0, 180)}`,
    });
    return json({ ok: true });
  }),
});

export default http;
