import { internalMutation } from "./_generated/server";

/**
 * Demo data. NOT callable from clients (internal). Wipes every table, then inserts a small, realistic set.
 * Run: `npx convex run seed:reset`  (afterwards sign in once and run users:promoteToAdmin for your email).
 * Seed lenders are placeholder rows (clerkId "seed-*"): they cannot sign in.
 */
const day = 86400000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const t of ["reminders", "activityLog", "borrowRequests", "tools", "users"] as const) {
      for (const row of await ctx.db.query(t).collect()) await ctx.db.delete(row._id);
    }
    const mk = (name: string, trustedLender: boolean) =>
      ctx.db.insert("users", { clerkId: `seed-${name.split(" ")[0].toLowerCase()}`, name, email: `${name.split(" ")[0].toLowerCase()}@lendloop.example`, role: "user", trustedLender });
    const priya = await mk("Priya Nair", true);
    const tom = await mk("Tom Becker", false);
    const aisha = await mk("Aisha Rahman", true);
    const luis = await mk("Luis Ortega", false);

    const tool = (ownerId: typeof priya, name: string, category: "power tools" | "garden" | "kitchen" | "camping" | "other", condition: string, description: string, status: "available" | "on_loan" = "available") =>
      ctx.db.insert("tools", { ownerId, name, category, condition, description, status });
    await tool(priya, "Cordless drill (18V)", "power tools", "Like new", "Two batteries and a case. Bits included.");
    await tool(priya, "Orbital sander", "power tools", "Good", "Comes with 20 sanding sheets.");
    const washer = await tool(tom, "Pressure washer", "power tools", "Good", "Electric, 1800 PSI. Hose included.", "on_loan");
    await tool(tom, "Extension ladder (4m)", "other", "Good", "Aluminium. Needs two people to carry.");
    await tool(aisha, "Hedge trimmer", "garden", "Good", "Electric, 50cm blade.");
    await tool(aisha, "Lawn aerator", "garden", "Fair", "Manual spike roller.");
    await tool(aisha, "Stand mixer", "kitchen", "Like new", "5L bowl with dough hook and whisk.");
    await tool(luis, "4-person tent", "camping", "Good", "Easy pitch, groundsheet included.");
    await tool(luis, "Camping stove", "camping", "Good", "Two burners, gas not included.");
    await tool(luis, "Wallpaper steamer", "other", "Good", "Strips wallpaper fast. Cleaned after each use.");

    const now = Date.now();
    const loan = await ctx.db.insert("borrowRequests", { toolId: washer, borrowerId: priya, lenderId: tom, startDate: iso(-2), endDate: iso(3), status: "approved", reminderCount: 0 });
    await ctx.db.insert("activityLog", { requestId: loan, type: "request_created", at: now - 3 * day, summary: `Request created for ${iso(-2)} to ${iso(3)}` });
    await ctx.db.insert("activityLog", { requestId: loan, type: "status_changed", at: now - 2.5 * day, summary: "Status changed to approved" });
  },
});
