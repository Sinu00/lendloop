"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import Icon from "@/components/Icon";
import type { Id } from "@/convex/_generated/dataModel";

const CATEGORIES = ["power tools", "garden", "kitchen", "camping", "other"] as const;
type Category = (typeof CATEGORIES)[number];
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
const statusTone = (st: string) => ({ pending: "warn", approved: "blue", returned: "", declined: "bad", cancelled: "gray", available: "", on_loan: "warn" } as Record<string, string>)[st] ?? "gray";
function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="empty"><div className="big"><Icon name={icon} size={34} /></div><h3>{title}</h3><p>{text}</p></div>;
}
/** Two-step destructive action: the first click asks, the second one acts. No browser dialogs. */
function ConfirmButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => unknown }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button className="danger" onClick={() => setAsking(true)}>{label}</button>;
  return (
    <>
      <button className="danger" onClick={async () => { setAsking(false); await onConfirm(); }}>{confirmLabel}</button>
      <button className="ghost" onClick={() => setAsking(false)}>Keep it</button>
    </>
  );
}
const todayIso = () => new Date().toISOString().slice(0, 10);
function Skeletons() {
  return <div className="grid"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;
}
type Tab = "browse" | "listings" | "requests" | "incoming" | "admin";

function useAction<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
  const [error, setError] = useState<string | null>(null);
  const run = async (...a: A) => {
    setError(null);
    try {
      await fn(...a);
      return true;
    } catch (e) {
      // Convex wraps server errors; show the readable tail.
      setError((e instanceof Error ? e.message : "Something went wrong").split("\n")[0].replace(/^.*Uncaught Error:\s*/, ""));
      return false;
    }
  };
  return { run, error };
}

export default function Dashboard() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const [tab, setTab] = useState<Tab>("browse");

  useEffect(() => {
    if (isAuthenticated) void ensure();
  }, [isAuthenticated, ensure]);

  const mine = useQuery(api.tools.mine, isAuthenticated && me ? {} : "skip");
  const incoming = useQuery(api.requests.incoming, isAuthenticated && me ? {} : "skip");
  const myReqs = useQuery(api.requests.myRequests, isAuthenticated && me ? {} : "skip");
  if (isLoading || !isAuthenticated || !me) return <Skeletons />;
  const pendingIn = incoming?.filter((r) => r.status === "pending").length ?? 0;
  const out = myReqs?.filter((r) => r.status === "approved").length ?? 0;
  const lent = incoming?.filter((r) => r.status === "approved").length ?? 0;
  const tabs: [Tab, string, number][] = [["browse", "Browse tools", 0], ["listings", "My listings", 0], ["requests", "My requests", 0], ["incoming", "Incoming requests", pendingIn]];
  if (me.role === "admin") tabs.push(["admin", "Admin", 0]);

  return (
    <>
      <div className="greet">
        <h2>Hi {me.name}</h2>
        {me.role === "admin" && <span className="tag blue">admin</span>}
        {me.trustedLender && <span className="tag">trusted lender</span>}
      </div>
      <div className="stats">
        <div className="stat"><div className="v">{mine?.length ?? "–"}</div><div className="l">Tools you&apos;ve listed</div></div>
        <div className={pendingIn ? "stat alert" : "stat"}><div className="v">{pendingIn}</div><div className="l">Requests waiting for you</div></div>
        <div className="stat"><div className="v">{lent}</div><div className="l">Tools out on loan</div></div>
        <div className="stat"><div className="v">{out}</div><div className="l">Tools you&apos;re borrowing</div></div>
      </div>
      <div className="tabs">
        {tabs.map(([k, label, n]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}{n > 0 && <span className="count">{n}</span>}</button>
        ))}
      </div>
      {tab === "browse" && <Browse isAdmin={me.role === "admin"} />}
      {tab === "listings" && <Listings />}
      {tab === "requests" && <Requests mode="mine" />}
      {tab === "incoming" && <Requests mode="incoming" />}
      {tab === "admin" && me.role === "admin" && <Admin />}
    </>
  );
}

function ago(ts: number) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d >= 1) return `${d} day${d > 1 ? "s" : ""} ago`;
  const h = Math.floor((Date.now() - ts) / 3600000);
  return h >= 1 ? `${h}h ago` : "just now";
}
const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
const label = (st: string) => (st === "on_loan" ? "on loan" : st);
function Browse({ isAdmin }: { isAdmin: boolean }) {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.listAll, category ? { category } : {});
  const request = useMutation(api.requests.create);
  const remove = useMutation(api.tools.remove);
  const [open, setOpen] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const rq = useAction(async (toolId: Id<"tools">) => request({ toolId, startDate: start, endDate: end }));
  const rm = useAction(async (toolId: Id<"tools">) => remove({ toolId }));

  return (
    <>
      <div className="filters">
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as Category | "")} style={{ maxWidth: 220 }}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="muted" style={{ alignSelf: "center" }}>{tools ? `${tools.length} tool${tools.length === 1 ? "" : "s"}` : ""}</span>
      </div>
      {rq.error && <p className="err">{rq.error}</p>}
      {rm.error && <p className="err">{rm.error}</p>}
      {tools === undefined && <Skeletons />}
      <div className="grid">
        {tools?.map((t) => (
          <div className="card" key={t._id}>
            <div className="top">
              <span className="ico"><Icon name={t.category} /></span>
              <div>
                <h3>{t.name}</h3>
                <div className="tags">
                  <span className="tag">{t.category}</span>
                  <span className={t.status === "available" ? "tag" : "tag warn"}>{t.status === "available" ? "available" : "on loan"}</span>
                </div>
              </div>
            </div>
            <p className="muted">{t.condition}{t.description ? ` · ${t.description}` : ""}</p>
            <div className="who"><span className="avatar">{initials(t.ownerName)}</span>Lender: {t.ownerName}{t.ownerTrusted ? " ✓ trusted" : ""}</div>
            <div className="actions">
              {!t.isMine && t.status === "available" && (
                <button className="ghost" onClick={() => { setStart(""); setEnd(""); setOpen(open === t._id ? null : t._id); }}>
                  {open === t._id ? "Close" : "Request"}
                </button>
              )}
              {t.isMine && <span className="tag gray">your listing</span>}
              {isAdmin && <ConfirmButton label="Remove (admin)" confirmLabel="Remove listing" onConfirm={() => rm.run(t._id)} />}
            </div>
            {open === t._id && (
              <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
                <label className="f">From<input type="date" min={todayIso()} value={start} onChange={(e) => { setStart(e.target.value); if (end && end < e.target.value) setEnd(""); }} /></label>
                <label className="f">Until<input type="date" min={start || todayIso()} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
                <div className="actions">
                  <button disabled={!start || !end} onClick={async () => { if (await rq.run(t._id)) setOpen(null); }}>Send request</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {tools?.length === 0 && <Empty icon="search" title="No tools here yet" text={category ? "Nothing in this category. Try another one, or list something yourself." : "Nobody has listed a tool yet. Add yours from My listings."} />}
    </>
  );
}

function Listings() {
  const tools = useQuery(api.tools.mine);
  const create = useMutation(api.tools.create);
  const remove = useMutation(api.tools.remove);
  const [f, setF] = useState({ name: "", category: "power tools" as Category, condition: "Good", description: "" });
  const c = useAction(async () => create(f));
  const r = useAction(async (toolId: Id<"tools">) => remove({ toolId }));
  const update = useMutation(api.tools.update);
  type Draft = { toolId: Id<"tools">; name: string; category: Category; condition: string; description: string };
  const [editing, setEditing] = useState<Draft | null>(null);
  const u = useAction(async (d: Draft) => update(d));
  return (
    <>
      <div className="panel">
        <h3>List a tool</h3>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await c.run()) setF({ ...f, name: "", description: "" }); }}>
          <input required placeholder="Tool name" aria-label="Tool name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category })}>
            {CATEGORIES.map((x) => <option key={x}>{x}</option>)}
          </select>
          <input required placeholder="Condition" aria-label="Condition" maxLength={60} value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} />
          <input placeholder="Short description" aria-label="Short description" maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <button type="submit">List tool</button>
        </form>
      </div>
      {c.error && <p className="err">{c.error}</p>}
      {r.error && <p className="err">{r.error}</p>}
      {tools === undefined && <Skeletons />}
      {u.error && <p className="err">{u.error}</p>}
      <div className="grid">
        {tools?.map((t) =>
          editing?.toolId === t._id ? (
            <form
              className="card"
              key={t._id}
              onSubmit={async (e) => { e.preventDefault(); if (await u.run(editing)) setEditing(null); }}
            >
              <h3>Edit listing</h3>
              <label className="f">Name<input required maxLength={80} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              <label className="f">Category
                <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as Category })}>
                  {CATEGORIES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
              <label className="f">Condition<input required maxLength={60} value={editing.condition} onChange={(e) => setEditing({ ...editing, condition: e.target.value })} /></label>
              <label className="f">Description<input maxLength={300} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
              <div className="actions">
                <button type="submit">Save changes</button>
                <button type="button" className="ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="card" key={t._id}>
              <div className="top">
                <span className="ico"><Icon name={t.category} /></span>
                <div>
                  <h3>{t.name}</h3>
                  <div className="tags"><span className="tag">{t.category}</span><span className={`tag ${statusTone(t.status)}`}>{label(t.status)}</span></div>
                </div>
              </div>
              <p className="muted">{t.condition}{t.description ? ` · ${t.description}` : ""}</p>
              <div className="actions">
                <button
                  className="ghost"
                  onClick={() => setEditing({ toolId: t._id, name: t.name, category: t.category, condition: t.condition, description: t.description })}
                >
                  Edit
                </button>
                {t.status === "on_loan"
                  ? <span className="tag gray">on loan: can&apos;t delete</span>
                  : <ConfirmButton label="Delete" confirmLabel="Delete listing" onConfirm={() => r.run(t._id)} />}
              </div>
            </div>
          ),
        )}
      </div>
      {tools?.length === 0 && <Empty icon="other" title="You have not listed anything yet" text="Add a drill, a ladder, a tent. Anything you rarely use is a good start." />}
    </>
  );
}

function Requests({ mode }: { mode: "mine" | "incoming" }) {
  const mine = useQuery(api.requests.myRequests, mode === "mine" ? {} : "skip");
  const inc = useQuery(api.requests.incoming, mode === "incoming" ? {} : "skip");
  const rows = mode === "mine" ? mine : inc;
  return <RequestList rows={rows} mode={mode} />;
}

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.requests.myRequests>>>[number];
function RequestList({ rows, mode }: { rows: Row[] | undefined; mode: "mine" | "incoming" | "all" }) {
  const approve = useMutation(api.requests.approve);
  const decline = useMutation(api.requests.decline);
  const returned = useMutation(api.requests.markReturned);
  const cancel = useMutation(api.requests.cancel);
  const a = useAction(async (fn: "approve" | "decline" | "returned" | "cancel", id: Id<"borrowRequests">) => {
    const m = { approve, decline, returned, cancel }[fn];
    await m({ requestId: id });
  });
  return (
    <>
      {a.error && <p className="err">{a.error}</p>}
      {rows === undefined && <Skeletons />}
      <div className="grid">
        {rows?.map((r) => (
          <div className="card" key={r._id}>
            <div className="top">
              <span className="ico"><Icon name="calendar" /></span>
              <div>
                <h3>{r.toolName}</h3>
                <div className="tags"><span className={`tag ${statusTone(r.status)}`}>{r.status}</span></div>
              </div>
            </div>
            <p className="muted"><b>{fmt(r.startDate)}</b> → <b>{fmt(r.endDate)}</b></p>
            <div className="who"><span className="avatar">{initials(r.borrowerName)}</span>Borrower: {r.borrowerName}</div>
            <div className="who"><span className="avatar">{initials(r.lenderName)}</span>Lender: {r.lenderName}</div>
            <div className="actions">
              {mode === "incoming" && r.status === "pending" && (<><button onClick={() => a.run("approve", r._id)}>Approve</button><button className="ghost" onClick={() => a.run("decline", r._id)}>Decline</button></>)}
              {mode === "incoming" && r.status === "approved" && <button onClick={() => a.run("returned", r._id)}>Mark returned</button>}
              {mode === "mine" && r.status === "pending" && <button className="ghost" onClick={() => a.run("cancel", r._id)}>Cancel</button>}
            </div>
            {r.recentActivity.length > 0 && (
              <ul className="log">{r.recentActivity.map((l, i) => <li key={i}>{l.summary} · {ago(l.at)}</li>)}</ul>
            )}
          </div>
        ))}
      </div>
      {rows?.length === 0 && (mode === "incoming"
        ? <Empty icon="inbox" title="No requests yet" text="When a neighbor asks to borrow one of your tools, it shows up here for you to approve." />
        : mode === "mine"
        ? <Empty icon="handshake" title="You haven't requested anything" text="Browse tools and ask to borrow one for the dates you need." />
        : <Empty icon="list" title="No loans yet" text="Loans from every user will appear here." />)}
    </>
  );
}

function Admin() {
  const users = useQuery(api.users.listForAdmin);
  const loans = useQuery(api.requests.allLoans);
  const setTrusted = useMutation(api.users.setTrustedLender);
  const t = useAction(async (userId: Id<"users">, trusted: boolean) => setTrusted({ userId, trusted }));
  const issues = useQuery(api.requests.automationIssues);
  return (
    <>
      <div className="section-head">
        <h2>Automation health</h2>
        {issues && <span className="muted">{issues.length ? `${issues.length} recent problem${issues.length === 1 ? "" : "s"}` : "No recent problems"}</span>}
      </div>
      <div className="panel">
        {issues === undefined && <p className="muted">Loading…</p>}
        {issues?.length === 0 && <p className="muted">No n8n failures or undelivered notifications. Failed runs and notifications appear here.</p>}
        {issues && issues.length > 0 && (
          <ul className="log" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}>
            {issues.map((l) => (
              <li key={l._id}>
                <span className="tag bad" style={{ marginRight: 8 }}>{l.type === "automation_failure" ? "n8n run failed" : "notification not delivered"}</span>
                {l.summary} · {ago(l.at)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="section-head"><h2>Lenders</h2></div>
      {t.error && <p className="err">{t.error}</p>}
      <div className="grid">
        {users?.map((u) => (
          <div className="card" key={u._id}>
            <div className="top">
              <span className="avatar" style={{ width: 42, height: 42, fontSize: 15 }}>{initials(u.name)}</span>
              <div>
                <h3>{u.name}</h3>
                <div className="tags"><span className={u.role === "admin" ? "tag blue" : "tag gray"}>{u.role}</span>{u.trustedLender && <span className="tag">trusted lender</span>}</div>
              </div>
            </div>
            <div className="actions">
              <button className="ghost" onClick={() => t.run(u._id, !u.trustedLender)}>{u.trustedLender ? "Remove trusted" : "Mark trusted lender"}</button>
            </div>
          </div>
        ))}
      </div>
      <div className="section-head" style={{ marginTop: 28 }}><h2>All loans</h2></div>
      <RequestList rows={loans} mode="all" />
    </>
  );
    }
