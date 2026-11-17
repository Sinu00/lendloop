import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { Actor } from "./rbac";

type Ctx = QueryCtx | MutationCtx;

/** Resolve the signed-in user from the verified Clerk JWT. Throws when signed out or not yet provisioned. */
export async function getAuthUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (!user) throw new Error("User not provisioned: call users.ensure first");
  return user;
}

export const asActor = (u: Doc<"users">): Actor => ({ id: u._id, role: u.role });

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getAuthUser(ctx);
  if (user.role !== "admin") throw new Error("Forbidden: admin only");
  return user;
}

export const today = () => new Date().toISOString().slice(0, 10);
