import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { asActor, getAuthUser } from "./lib/auth";
import { canEditTool, canRemoveTool, clean } from "./lib/rbac";

const category = v.union(
  v.literal("power tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("other"),
);

/** PUBLIC (no auth): name + category of available tools only. No owner, no ids that leak users. */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status", (q) => q.eq("status", "available"))
      .take(100);
    return tools.map((t) => ({ _id: t._id, name: t.name, category: t.category }));
  },
});

/** Signed-in: all non-removed tools with availability, optional category filter. Owner shown by display name only. */
export const listAll = query({
  args: { category: v.optional(category) },
  handler: async (ctx, { category }) => {
    const me = await getAuthUser(ctx);
    const rows = category
      ? await ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", category)).take(200)
      : await ctx.db.query("tools").take(200);
    const visible = rows.filter((t) => t.status !== "removed");
    return await Promise.all(
      visible.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          status: t.status,
          ownerName: owner?.name ?? "Neighbor",
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: t.ownerId === me._id,
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUser(ctx);
    const rows = await ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", me._id)).collect();
    return rows.filter((t) => t.status !== "removed");
  },
});

export const create = mutation({
  args: { name: v.string(), category, condition: v.string(), description: v.string() },
  handler: async (ctx, args) => {
    const me = await getAuthUser(ctx);
    const name = clean(args.name, 80);
    if (!name) throw new Error("Name is required");
    return await ctx.db.insert("tools", {
      ownerId: me._id,
      name,
      category: args.category,
      condition: clean(args.condition, 60),
      description: clean(args.description, 300),
      status: "available",
    });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), name: v.string(), category, condition: v.string(), description: v.string() },
  handler: async (ctx, args) => {
    const me = await getAuthUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool || !canEditTool(asActor(me), tool)) throw new Error("Forbidden");
    const name = clean(args.name, 80);
    if (!name) throw new Error("Name is required");
    await ctx.db.patch(args.toolId, {
      name,
      category: args.category,
      condition: clean(args.condition, 60),
      description: clean(args.description, 300),
    });
  },
});

/** Owner deletes own listing; admin may remove any. Soft delete keeps loan history intact. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await getAuthUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || !canRemoveTool(asActor(me), tool)) throw new Error("Forbidden");
    if (tool.status === "on_loan") throw new Error("Tool is on loan; mark it returned first");
    // Close out any pending requests so nobody waits on a removed listing.
    const pending = await ctx.db.query("borrowRequests").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
    for (const r of pending) if (r.status === "pending") await ctx.db.patch(r._id, { status: "declined" });
    await ctx.db.patch(toolId, { status: "removed" });
  },
});
