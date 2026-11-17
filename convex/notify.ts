import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sign } from "./lib/hmac";

type NotificationPayload = Record<string, string>;
const MAX_ATTEMPTS = 5;
const backoffMs = (attempt: number) => Math.min(60_000 * 2 ** (attempt - 1), 30 * 60_000); // 1m, 2m, 4m, 8m

/**
 * Convex -> n8n. POSTs a minimal, HMAC-signed payload. Non-2xx or network errors are retried with
 * exponential backoff; after the last attempt the failure is written to the activity log (visible in the app).
 */
export const send = internalAction({
  args: { requestId: v.id("borrowRequests"), event: v.string(), attempt: v.number() },
  handler: async (ctx, { requestId, event, attempt }): Promise<void> => {
    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_HMAC_SECRET;
    const fail = async (why: string) => {
      if (attempt < MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(backoffMs(attempt), internal.notify.send, { requestId, event, attempt: attempt + 1 });
      } else {
        await ctx.runMutation(internal.requests.logActivity, {
          requestId,
          type: "notification_failed",
          summary: `Notification "${event}" failed after ${attempt} attempts: ${why}`,
        });
      }
    };
    if (!url || !secret) return await fail("N8N_WEBHOOK_URL or LENDLOOP_HMAC_SECRET not set");

    const payload: NotificationPayload | null = await ctx.runMutation(internal.requests.notificationPayload, { requestId, event });
    if (!payload) return; // request vanished; nothing to notify

    const body: string = JSON.stringify({ ...payload, eventId: `${requestId}:${event}` });
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const res: Response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lendloop-timestamp": timestamp,
          "x-lendloop-signature": await sign(secret, timestamp, body),
        },
        body,
      });
      if (!res.ok) return await fail(`n8n responded ${res.status}`);
      await ctx.runMutation(internal.requests.logActivity, {
        requestId,
        type: "notification_sent",
        summary: `Notification "${event}" delivered to n8n`,
      });
    } catch (e) {
      await fail(e instanceof Error ? e.message : "network error");
    }
  },
});
