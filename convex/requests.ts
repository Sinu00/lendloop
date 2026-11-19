import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { asActor, getAuthUser, requireAdmin, today } from "./lib/auth";
import {
  type Actor,
  canCancel,
  canDecide,
  canMarkReturned,
  canRequestTool,
  rangesOverlap,
  validateRange,
} from "./lib/rbac";

type Event = "request_created" | "approved" | "declined" | "returned" | "cancelled";

async function log(
  ctx: MutationCtx,
  requestId: Id<"borrowRequests">,
  type: "request_created" | "status_changed",
  summary: string,
) {
  await ctx.db.insert("activityLog", { requestId, type, at: Date.now(), summary });
}

/** Queue the n8n notification. Runs as a Convex action with retries (see notify.ts). */
async function queueNotification(ctx: MutationCtx, requestId: Id<"borrowRequests">, event: Event) {
  await ctx.scheduler.runAfter(0, internal.notify.send, { requestId, event, attempt: 1 });
}

export const create = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await getAuthUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || !canRequestTool(asActor(me), tool)) throw new Error("This tool cannot be requested");
    const err = validateRange(startDate, endDate, today());
    if (err) throw new Error(err);
    const existing = await ctx.db.query("borrowRequests").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
    const dupe = existing.find((r) => r.borrowerId === me._id && r.status === "pending");
    if (dupe) throw new Error("You already have a pending request for this tool");
    const clash = existing.find(
      (r) => r.status === "approved" && rangesOverlap(startDate, endDate, r.startDate, r.endDate),
    );
    if (clash) throw new Error("Those dates overlap an approved loan");
    const id = await ctx.db.insert("borrowRequests", {
      toolId,
      borrowerId: me._id,
      lenderId: tool.ownerId, // taken from the DB row, never from the client
      startDate,
      endDate,
      status: "pending",
      reminderCount: 0,
    });
    await log(ctx, id, "request_created", `Request created for ${startDate} to ${endDate}`);
    await queueNotification(ctx, id, "request_created");
    return id;
  },
});

async function transition(
  ctx: MutationCtx,
  requestId: Id<"borrowRequests">,
  check: (a: Actor, r: Doc<"borrowRequests">) => boolean,
  status: "approved" | "declined" | "returned" | "cancelled",
  toolStatus?: "available" | "on_loan",
) {
  const me = await getAuthUser(ctx);
  const req = await ctx.db.get(requestId);
  if (!req || !check(asActor(me), req)) throw new Error("Forbidden or invalid state");
  if (status === "approved") {
    const tool = await ctx.db.get(req.toolId);
    if (!tool || tool.status !== "available") throw new Error("Tool is not available");
  }
  await ctx.db.patch(requestId, { status });
  if (toolStatus) await ctx.db.patch(req.toolId, { status: toolStatus });
  await log(ctx, requestId, "status_changed", `Status changed to ${status}`);
  await queueNotification(ctx, requestId, status);
}

export const approve = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: (ctx, { requestId }) => transition(ctx, requestId, canDecide, "approved", "on_loan"),
});
export const decline = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: (ctx, { requestId }) => transition(ctx, requestId, canDecide, "declined"),
});
export const markReturned = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: (ctx, { requestId }) => transition(ctx, requestId, canMarkReturned, "returned", "available"),
});
export const cancel = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: (ctx, { requestId }) => transition(ctx, requestId, canCancel, "cancelled"),
});

async function hydrate(ctx: { db: MutationCtx["db"] }, rows: Array<any>) {
  return await Promise.all(
    rows.map(async (r) => {
      const [tool, borrower, lender, logs] = await Promise.all([
        ctx.db.get(r.toolId),
        ctx.db.get(r.borrowerId),
        ctx.db.get(r.lenderId),
        ctx.db.query("activityLog").withIndex("by_request", (q: any) => q.eq("requestId", r._id)).order("desc").take(3),
      ]);
      return {
        _id: r._id,
        toolName: (tool as any)?.name ?? "(removed)",
        toolCategory: ((tool as any)?.category ?? "other") as string,
        borrowerName: (borrower as any)?.name ?? "Neighbor",
        lenderName: (lender as any)?.name ?? "Neighbor",
        startDate: r.startDate,
        endDate: r.endDate,
        status: r.status,
        reminderCount: r.reminderCount,
        lastReminderDate: r.lastReminderDate ?? null,
        recentActivity: (logs as any[]).map((l) => ({ type: l.type, at: l.at, summary: l.summary })),
      };
    }),
  );
}

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUser(ctx);
    const rows = await ctx.db.query("borrowRequests").withIndex("by_borrower", (q) => q.eq("borrowerId", me._id)).order("desc").take(100);
    return hydrate(ctx as any, rows);
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUser(ctx);
    const rows = await ctx.db.query("borrowRequests").withIndex("by_lender", (q) => q.eq("lenderId", me._id)).order("desc").take(100);
    return hydrate(ctx as any, rows);
  },
});

/** Admin only: every loan. */
export const allLoans = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("borrowRequests").order("desc").take(200);
    return hydrate(ctx as any, rows);
  },
});

/**
 * Admin only: recent automation problems, newest first. n8n failures (reported by the error workflow)
 * are not tied to one loan, so this is where they become visible in the app.
 */
export const automationIssues = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [n8nFailures, notifyFailures] = await Promise.all([
      ctx.db.query("activityLog").withIndex("by_type", (q) => q.eq("type", "automation_failure")).order("desc").take(20),
      ctx.db.query("activityLog").withIndex("by_type", (q) => q.eq("type", "notification_failed")).order("desc").take(20),
    ]);
    return [...n8nFailures, ...notifyFailures]
      .sort((a, b) => b.at - a.at)
      .slice(0, 20)
      .map((l) => ({ _id: l._id, type: l.type, at: l.at, summary: l.summary }));
  },
});

// ---- Internal helpers used by notify.ts / http.ts (not callable from clients) ----

export const notificationPayload = internalMutation({
  args: { requestId: v.id("borrowRequests"), event: v.string() },
  handler: async (ctx, { requestId, event }) => {
    const r = await ctx.db.get(requestId);
    if (!r) return null;
    const [tool, borrower, lender] = await Promise.all([ctx.db.get(r.toolId), ctx.db.get(r.borrowerId), ctx.db.get(r.lenderId)]);
    if (!tool || !borrower || !lender) return null;
    // Recipient: lender hears about new/cancelled requests; borrower hears about decisions.
    const toLender = event === "request_created" || event === "cancelled";
    const recipient = toLender ? lender : borrower;
    const actor = toLender ? borrower : lender;
    // Data minimization: only what the notification needs.
    const payload: Record<string, string> = {
      event,
      requestId: r._id as string,
      toolName: tool.name,
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      actorName: actor.name,
      status: r.status,
      startDate: r.startDate,
      endDate: r.endDate,
    };
    return payload;
  },
});

export const logActivity = internalMutation({
  args: {
    requestId: v.optional(v.id("borrowRequests")),
    type: v.union(v.literal("notification_sent"), v.literal("notification_failed"), v.literal("automation_failure")),
    summary: v.string(),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("activityLog", { requestId: a.requestId, type: a.type, at: Date.now(), summary: a.summary.slice(0, 300) });
  },
});

export const overdueLoans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const t = today();
    const rows = await ctx.db
      .query("borrowRequests")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", t))
      .take(500);
    const out = [];
    for (const r of rows) {
      const [tool, borrower] = await Promise.all([ctx.db.get(r.toolId), ctx.db.get(r.borrowerId)]);
      if (!tool || !borrower) continue;
      out.push({
        requestId: r._id as string,
        toolName: tool.name,
        borrowerName: borrower.name,
        borrowerEmail: borrower.email,
        endDate: r.endDate,
        daysOverdue: Math.max(1, Math.round((Date.parse(t) - Date.parse(r.endDate)) / 86400000)),
        remindedToday: r.lastReminderDate === t,
      });
    }
    return out;
  },
});

/** Idempotent: the same idempotencyKey (requestId:YYYY-MM-DD) is applied at most once. */
export const recordReminder = internalMutation({
  args: { requestId: v.id("borrowRequests"), sentOn: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { requestId, sentOn, idempotencyKey }) => {
    const seen = await ctx.db.query("reminders").withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey)).unique();
    if (seen) return { duplicate: true };
    const r = await ctx.db.get(requestId);
    if (!r || r.status !== "approved") return { duplicate: false, ignored: true };
    await ctx.db.insert("reminders", { idempotencyKey, requestId, sentOn });
    await ctx.db.patch(requestId, { lastReminderDate: sentOn, reminderCount: r.reminderCount + 1 });
    await ctx.db.insert("activityLog", { requestId, type: "reminder_sent", at: Date.now(), summary: `Overdue reminder sent (${sentOn})` });
    return { duplicate: false };
  },
});
