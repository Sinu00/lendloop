import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const category = v.union(
  v.literal("power tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("other"),
);

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  }).index("by_clerkId", ["clerkId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition: v.string(),
    description: v.string(),
    status: v.union(v.literal("available"), v.literal("on_loan"), v.literal("removed")),
  })
    .index("by_status", ["status"])
    .index("by_category", ["category"])
    .index("by_owner", ["ownerId"]),

  borrowRequests: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    lenderId: v.id("users"), // denormalized from the tool at creation time: cheap, tamper-proof auth checks
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("returned"),
      v.literal("cancelled"),
    ),
    lastReminderDate: v.optional(v.string()),
    reminderCount: v.number(),
  })
    .index("by_tool", ["toolId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status_endDate", ["status", "endDate"]),

  activityLog: defineTable({
    requestId: v.optional(v.id("borrowRequests")),
    type: v.union(
      v.literal("request_created"),
      v.literal("status_changed"),
      v.literal("notification_sent"),
      v.literal("notification_failed"),
      v.literal("reminder_sent"),
      v.literal("automation_failure"),
    ),
    at: v.number(),
    summary: v.string(),
  }).index("by_request", ["requestId"]),

  // Idempotency ledger for n8n write-backs: one row per (request, day).
  reminders: defineTable({
    idempotencyKey: v.string(),
    requestId: v.id("borrowRequests"),
    sentOn: v.string(),
  }).index("by_key", ["idempotencyKey"]),
});
