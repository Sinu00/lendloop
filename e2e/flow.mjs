// Browser end-to-end run: two real Clerk test users (lender, borrower) go through the whole loan flow,
// then server-side RBAC is probed with their real Clerk JWTs against Convex.
// Run: npm run build && npm run test:e2e   (needs .env.local with Clerk dev keys + NEXT_PUBLIC_CONVEX_URL)
// Screenshots land in e2e/screenshots/. Creates throwaway users and tools: reseed afterwards (npx convex run seed:reset).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { BASE_URL, ROOT, SHOTS, browser, signUp, startServer } from "./lib.mjs";

const convexUrl =
  process.env.NEXT_PUBLIC_CONVEX_URL ??
  readFileSync(path.join(ROOT, ".env.local"), "utf8").match(/^NEXT_PUBLIC_CONVEX_URL=(.+)$/m)?.[1]?.trim();
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not found (env or .env.local)");

const srv = await startServer();
const b = await browser();
const mk = async () => {
  const c = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await c.newPage();
  p.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));
  return p;
};
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, `e2e-${n}.png`), fullPage: true });
let passed = 0, failed = 0;
const ok = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); cond ? passed++ : failed++; };
const id = Date.now().toString(36);

try {
  const A = await mk(), B = await mk();
  await signUp(A, `ll-lender-${id}+clerk_test@example.com`, "A");
  await signUp(B, `ll-borrower-${id}+clerk_test@example.com`, "B");

  // Lender lists two tools
  await A.goto(`${BASE_URL}/dashboard`);
  await A.getByRole("button", { name: "My listings" }).click();
  async function listTool(name, cat, desc) {
    await A.getByPlaceholder("Tool name").fill(name);
    await A.locator("form select").first().selectOption(cat);
    await A.getByPlaceholder("Short description").fill(desc);
    await A.getByRole("button", { name: "List tool" }).click();
    await A.getByText(name, { exact: true }).first().waitFor({ timeout: 15000 });
  }
  await listTool(`Cordless Drill ${id}`, "power tools", "18V with 2 batteries");
  await listTool(`Hedge Trimmer ${id}`, "garden", "Electric, 50cm");
  await shot(A, "3-lender-listings");
  ok("lender sees own listings", (await A.innerText("body")).includes(`Hedge Trimmer ${id}`));

  // Lender edits a listing
  const drillCard = A.locator(".card", { hasText: `Cordless Drill ${id}` });
  await drillCard.getByRole("button", { name: "Edit" }).click();
  await A.getByLabel("Description", { exact: true }).fill("18V with 2 batteries and a case");
  await A.getByRole("button", { name: "Save changes" }).click();
  await A.getByText("18V with 2 batteries and a case", { exact: false }).first().waitFor({ timeout: 15000 }).catch(() => {});
  ok("lender can edit a listing", (await A.innerText("body")).includes("18V with 2 batteries and a case"));

  // Public page shows name + category only
  const pub = await (await b.newContext()).newPage();
  await pub.goto(BASE_URL); await pub.waitForTimeout(3000); await shot(pub, "4-public-with-tools");
  const pubText = await pub.innerText("body");
  ok("public page lists tools", pubText.includes(`Cordless Drill ${id}`) && pubText.includes(`Hedge Trimmer ${id}`));
  // Descriptions and owner names must not leak (seed tool names like "Cordless drill (18V)" are fine).
  ok("public page hides owner/description", !/2 batteries|Electric, 50cm|Lender:|ll-lender/i.test(pubText));

  // Borrower browses, filters, requests
  await B.goto(`${BASE_URL}/dashboard`); await B.waitForTimeout(2500);
  await B.locator("select").first().selectOption("garden"); await B.waitForTimeout(1500); await shot(B, "5-borrower-filter-garden");
  let t = await B.innerText("body");
  ok("category filter works", t.includes(`Hedge Trimmer ${id}`) && !t.includes(`Cordless Drill ${id}`));
  await B.locator("select").first().selectOption(""); await B.waitForTimeout(1000);
  const card = B.locator(".card", { hasText: `Cordless Drill ${id}` });
  await card.getByRole("button", { name: "Request" }).click();
  const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await card.locator('input[type="date"]').nth(0).fill(d(1));
  await card.locator('input[type="date"]').nth(1).fill(d(3));
  await card.getByRole("button", { name: "Send request" }).click(); await B.waitForTimeout(2000);
  await B.getByRole("button", { name: "My requests" }).click(); await B.waitForTimeout(2000); await shot(B, "6-borrower-my-requests");
  ok("borrower sees pending request", (await B.innerText("body")).toLowerCase().includes("pending"));

  // Lender approves
  await A.getByRole("button", { name: "Incoming requests" }).click(); await A.waitForTimeout(2000); await shot(A, "7-lender-incoming");
  await A.getByRole("button", { name: "Approve" }).click(); await A.waitForTimeout(2500);
  ok("lender approved", (await A.innerText("body")).includes("approved"));
  await B.reload(); await B.getByRole("button", { name: "My requests" }).click(); await B.waitForTimeout(2500); await shot(B, "8-borrower-approved");
  ok("borrower sees approved", (await B.innerText("body")).includes("approved"));

  // Public page no longer shows the loaned tool
  await pub.reload(); await pub.waitForTimeout(3000); t = await pub.innerText("body");
  ok("loaned tool leaves public list", !t.includes(`Cordless Drill ${id}`) && t.includes(`Hedge Trimmer ${id}`));
  ok("non-admin has no Admin tab", !(await B.getByRole("button", { name: "Admin", exact: true }).count()));

  // Mark returned
  await A.reload(); await A.getByRole("button", { name: "Incoming requests" }).click(); await A.waitForTimeout(2500);
  await A.getByRole("button", { name: "Mark returned" }).click(); await A.waitForTimeout(2500); await shot(A, "9-lender-returned");
  ok("marked returned", (await A.innerText("body")).includes("returned"));

  // Promote lender to admin (operator action via CLI), check the Admin tab
  execSync(`npx convex run users:promoteToAdmin '{"email":"ll-lender-${id}+clerk_test@example.com"}'`, { cwd: ROOT, stdio: "pipe" });
  await A.reload(); await A.waitForTimeout(3000);
  await A.getByRole("button", { name: "Admin", exact: true }).click(); await A.waitForTimeout(2500); await shot(A, "10-admin");
  await A.locator(".card", { hasText: "ll-borrower" }).first().getByRole("button", { name: /Mark trusted/ }).click()
    .catch((e) => console.log("trusted click:", e.message.slice(0, 100)));
  await A.waitForTimeout(2000); await shot(A, "11-admin-trusted");
  const adminText = await A.innerText("body");
  ok("admin sees All loans + trusted toggle", adminText.includes("All loans") && /trusted lender/i.test(adminText));
  ok("admin sees Automation health", adminText.includes("Automation health"));

  // ---- Server-side RBAC negative tests with real Clerk JWTs against Convex ----
  const tok = async (p) => p.evaluate(async () => await window.Clerk.session.getToken({ template: "convex" }));
  const cB = new ConvexHttpClient(convexUrl); cB.setAuth(await tok(B));
  const cA = new ConvexHttpClient(convexUrl); cA.setAuth(await tok(A));
  const anon = new ConvexHttpClient(convexUrl);
  const denies = async (name, fn, re) => {
    try { await fn(); ok(name, false); }
    catch (e) { ok(`${name} -> ${String(e.message).split("\n").find((l) => /Uncaught|Error/.test(l))?.slice(0, 90)}`, re.test(e.message)); }
  };
  const tools = await cB.query("tools:listAll", {});
  const trimmer = tools.find((x) => x.name === `Hedge Trimmer ${id}`);
  await denies("anonymous cannot read requests", () => anon.query("requests:myRequests", {}), /Not authenticated/);
  await denies("non-admin cannot remove someone else's listing", () => cB.mutation("tools:remove", { toolId: trimmer._id }), /Forbidden/);
  await denies("non-admin cannot edit someone else's listing", () => cB.mutation("tools:update", { toolId: trimmer._id, name: "x", category: "garden", condition: "x", description: "x" }), /Forbidden/);
  await denies("non-admin cannot list all loans", () => cB.query("requests:allLoans", {}), /admin only/);
  await denies("non-admin cannot read automation health", () => cB.query("requests:automationIssues", {}), /admin only/);
  const users = await cA.query("users:listForAdmin", {});
  await denies("non-admin cannot mark Trusted Lender", () => cB.mutation("users:setTrustedLender", { userId: users[0]._id, trusted: true }), /admin only/);
  const rid = await cB.mutation("requests:create", { toolId: trimmer._id, startDate: d(5), endDate: d(6) });
  ok("borrower can create a request", !!rid);
  await denies("borrower cannot approve own request", () => cB.mutation("requests:approve", { requestId: rid }), /Forbidden/);
  await denies("cannot send a duplicate pending request", () => cB.mutation("requests:create", { toolId: trimmer._id, startDate: d(5), endDate: d(6) }), /pending request/);
  await cA.mutation("requests:approve", { requestId: rid }); ok("lender can approve", true);
  await denies("lender cannot approve twice", () => cA.mutation("requests:approve", { requestId: rid }), /Forbidden/);

  // Mobile screenshots (iPhone size) reusing the lender session
  const mc = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, storageState: await A.context().storageState() });
  const M = await mc.newPage();
  await M.goto(BASE_URL); await M.waitForTimeout(3000); await M.screenshot({ path: path.join(SHOTS, "mobile-1-home.png"), fullPage: true });
  await M.goto(`${BASE_URL}/dashboard`); await M.waitForTimeout(3500); await M.screenshot({ path: path.join(SHOTS, "mobile-2-dashboard.png"), fullPage: true });
  await M.getByRole("button", { name: "My listings" }).click(); await M.waitForTimeout(1500); await M.screenshot({ path: path.join(SHOTS, "mobile-3-listings.png"), fullPage: true });
  await M.getByRole("button", { name: "Incoming requests" }).click(); await M.waitForTimeout(1500); await M.screenshot({ path: path.join(SHOTS, "mobile-4-incoming.png"), fullPage: true });
} catch (e) {
  failed++;
  console.log("ERROR", e.message.split("\n")[0]);
  let n = 0;
  for (const c of b.contexts()) for (const pg of c.pages()) {
    console.log(`  page ${n}: ${pg.url()}`);
    await pg.screenshot({ path: path.join(SHOTS, `error-page-${n++}.png`), fullPage: true }).catch(() => {});
  }
} finally {
  await b.close();
  srv.kill();
}
console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
