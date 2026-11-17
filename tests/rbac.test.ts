import { test } from "node:test";
import assert from "node:assert/strict";
import * as r from "../convex/lib/rbac";

const admin: r.Actor = { id: "A", role: "admin" };
const alice: r.Actor = { id: "alice", role: "user" };
const bob: r.Actor = { id: "bob", role: "user" };
const tool = (ownerId: string, status: r.ToolLike["status"] = "available"): r.ToolLike => ({ ownerId, status });
const req = (status: r.RequestLike["status"]): r.RequestLike => ({ borrowerId: "bob", lenderId: "alice", status });

test("only owner edits a listing; admin cannot edit others' content", () => {
  assert.equal(r.canEditTool(alice, tool("alice")), true);
  assert.equal(r.canEditTool(bob, tool("alice")), false);
  assert.equal(r.canEditTool(admin, tool("alice")), false);
});
test("remove: owner or admin, not other users, not already removed", () => {
  assert.equal(r.canRemoveTool(alice, tool("alice")), true);
  assert.equal(r.canRemoveTool(admin, tool("alice")), true);
  assert.equal(r.canRemoveTool(bob, tool("alice")), false);
  assert.equal(r.canRemoveTool(admin, tool("alice", "removed")), false);
});
test("cannot borrow own tool or an unavailable tool", () => {
  assert.equal(r.canRequestTool(bob, tool("alice")), true);
  assert.equal(r.canRequestTool(alice, tool("alice")), false);
  assert.equal(r.canRequestTool(bob, tool("alice", "on_loan")), false);
});
test("only the lender decides a pending request", () => {
  assert.equal(r.canDecide(alice, req("pending")), true);
  assert.equal(r.canDecide(bob, req("pending")), false);
  assert.equal(r.canDecide(admin, req("pending")), false);
  assert.equal(r.canDecide(alice, req("approved")), false);
});
test("only the lender marks an approved loan returned", () => {
  assert.equal(r.canMarkReturned(alice, req("approved")), true);
  assert.equal(r.canMarkReturned(bob, req("approved")), false);
  assert.equal(r.canMarkReturned(alice, req("pending")), false);
});
test("only the borrower cancels, only while pending", () => {
  assert.equal(r.canCancel(bob, req("pending")), true);
  assert.equal(r.canCancel(alice, req("pending")), false);
  assert.equal(r.canCancel(bob, req("approved")), false);
});
test("view: parties and admin only", () => {
  const carol: r.Actor = { id: "carol", role: "user" };
  assert.equal(r.canViewRequest(alice, req("pending")), true);
  assert.equal(r.canViewRequest(bob, req("pending")), true);
  assert.equal(r.canViewRequest(admin, req("pending")), true);
  assert.equal(r.canViewRequest(carol, req("pending")), false);
});
test("trusted lender + view-all are admin only", () => {
  assert.equal(r.canSetTrusted(admin), true);
  assert.equal(r.canSetTrusted(alice), false);
  assert.equal(r.canViewAllLoans(alice), false);
});
test("date validation and overlap", () => {
  assert.equal(r.validateRange("2026-12-01", "2026-12-05", "2026-11-18"), null);
  assert.ok(r.validateRange("2026-11-01", "2026-12-05", "2026-11-18"));
  assert.ok(r.validateRange("2026-12-05", "2026-12-01", "2026-11-18"));
  assert.ok(r.validateRange("12/01/2026", "2026-12-05", "2026-11-18"));
  assert.equal(r.rangesOverlap("2026-12-01", "2026-12-05", "2026-12-05", "2026-12-09"), true);
  assert.equal(r.rangesOverlap("2026-12-01", "2026-12-04", "2026-12-05", "2026-12-09"), false);
});
test("clean trims and caps", () => {
  assert.equal(r.clean("  a   b  ", 10), "a b");
  assert.equal(r.clean("abcdef", 3), "abc");
});
