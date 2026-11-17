// Pure authorization rules. Convex functions call these; they are unit tested without a database.
export type Role = "admin" | "user";
export interface Actor { id: string; role: Role }
export interface ToolLike { ownerId: string; status: "available" | "on_loan" | "removed" }
export interface RequestLike {
  borrowerId: string;
  lenderId: string;
  status: "pending" | "approved" | "declined" | "returned" | "cancelled";
}

export const isAdmin = (a: Actor) => a.role === "admin";

// Listings: owner edits/deletes their own; admin may remove any (but not edit others' content).
export const canEditTool = (a: Actor, t: ToolLike) => t.ownerId === a.id && t.status !== "removed";
export const canRemoveTool = (a: Actor, t: ToolLike) =>
  t.status !== "removed" && (t.ownerId === a.id || isAdmin(a));

export const canRequestTool = (a: Actor, t: ToolLike) => t.ownerId !== a.id && t.status === "available";

// Requests: only the lender decides / marks returned; only the borrower cancels.
export const canDecide = (a: Actor, r: RequestLike) => r.lenderId === a.id && r.status === "pending";
export const canMarkReturned = (a: Actor, r: RequestLike) => r.lenderId === a.id && r.status === "approved";
export const canCancel = (a: Actor, r: RequestLike) => r.borrowerId === a.id && r.status === "pending";
export const canViewRequest = (a: Actor, r: RequestLike) =>
  isAdmin(a) || r.borrowerId === a.id || r.lenderId === a.id;

export const canSetTrusted = (a: Actor) => isAdmin(a);
export const canViewAllLoans = (a: Actor) => isAdmin(a);

// Dates are "YYYY-MM-DD" strings.
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function validateRange(start: string, end: string, today: string): string | null {
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) return "Dates must be YYYY-MM-DD";
  if (start < today) return "Start date is in the past";
  if (end < start) return "End date is before start date";
  return null;
}
export const rangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart <= bEnd && bStart <= aEnd;

export const TOOL_CATEGORIES = ["power tools", "garden", "kitchen", "camping", "other"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export function clean(s: string, max: number): string {
  return s.trim().replace(/\s+/g, " ").slice(0, max);
}
