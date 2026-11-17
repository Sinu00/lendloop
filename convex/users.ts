import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUser, requireAdmin } from "./lib/auth";
import { clean } from "./lib/rbac";

/** Called by the client after sign-in. Creates the user row with role "user" (never trusts client-provided roles). */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
    const name = clean(identity.name ?? identity.nickname ?? "Neighbor", 80);
    const email = identity.email ?? "";
    if (existing) {
      if (existing.name !== name || existing.email !== email) await ctx.db.patch(existing._id, { name, email });
      return existing._id;
    }
    return await ctx.db.insert("users", {
      clerkId: identity.subject,
      name,
      email,
      role: "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const u = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
    return u ? { _id: u._id, name: u.name, role: u.role, trustedLender: u.trustedLender } : null;
  },
});

/** Admin only. Never exposes emails to the client. */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({ _id: u._id, name: u.name, role: u.role, trustedLender: u.trustedLender }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new Error("User not found");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/**
 * Bootstrap the first admin. Not callable from clients (internal): run from the Convex dashboard
 * (Functions -> users:promoteToAdmin) or `npx convex run users:promoteToAdmin '{"email":"you@example.com"}'`.
 */
export const promoteToAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const users = await ctx.db.query("users").collect();
    const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!u) throw new Error("No user with that email has signed in yet");
    await ctx.db.patch(u._id, { role: "admin" });
  },
});
