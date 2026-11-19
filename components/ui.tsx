"use client";
// Shared UI building blocks for the dashboard: sheet, confirm button, tool tile, status pill, empty state.
import { ReactNode, useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";

export const CATEGORIES = ["power tools", "garden", "kitchen", "camping", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const fmtDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const firstName = (n: string) => n.split(/\s+/)[0] || n;
export const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function ago(ts: number) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d >= 1) return `${d} day${d > 1 ? "s" : ""} ago`;
  const h = Math.floor((Date.now() - ts) / 3600000);
  return h >= 1 ? `${h}h ago` : "just now";
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Runs a Convex call and keeps a readable error message for the UI. */
export function useAction<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (...a: A) => {
    setError(null);
    setBusy(true);
    try {
      await fn(...a);
      return true;
    } catch (e) {
      // Convex wraps server errors; show the readable tail.
      setError((e instanceof Error ? e.message : "Something went wrong").split("\n")[0].replace(/^.*Uncaught Error:\s*/, "").replace(/^\[.*?\]\s*/, ""));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy, clear: () => setError(null) };
}

/** Category-tinted tile standing in for a photo. */
export function ToolTile({ category, size = "md", children }: { category: string; size?: "sm" | "md" | "lg"; children?: ReactNode }) {
  const icon = size === "sm" ? 22 : size === "lg" ? 64 : 44;
  return (
    <div className={`tile tile-${size}`} data-cat={category}>
      <Icon name={category} size={icon} stroke={size === "sm" ? 1.8 : 1.4} />
      {children}
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  pending: "Waiting for lender", approved: "On loan", declined: "Declined", returned: "Returned", cancelled: "Cancelled",
  available: "Available", on_loan: "On loan", overdue: "Overdue",
};
export function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${status}`}>{STATUS_TEXT[status] ?? status}</span>;
}

export function Empty({ icon, title, text, children }: { icon: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-ico"><Icon name={icon} size={30} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}

export function Skeletons({ n = 4 }: { n?: number }) {
  return <div className="grid">{Array.from({ length: n }, (_, i) => <div className="skeleton" key={i} />)}</div>;
}

export function ErrorNote({ text }: { text: string | null }) {
  return text ? <p className="err" role="alert">{text}</p> : null;
}

/** Two-step destructive action: the first tap asks, the second one acts. No browser dialogs. */
export function ConfirmButton({ label, confirmLabel, onConfirm, block }: { label: string; confirmLabel: string; onConfirm: () => unknown; block?: boolean }) {
  const [asking, setAsking] = useState(false);
  const cls = block ? " block" : "";
  if (!asking) return <button className={"btn danger" + cls} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span className={"confirm" + cls}>
      <button className="btn danger-solid" onClick={async () => { setAsking(false); await onConfirm(); }}>{confirmLabel}</button>
      <button className="btn ghost" onClick={() => setAsking(false)}>Keep it</button>
    </span>
  );
}

/** Bottom sheet on phones, centered dialog on wider screens. Escape or the backdrop closes it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={20} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
