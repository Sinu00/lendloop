"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const CATEGORIES = ["power tools", "garden", "kitchen", "camping", "other"] as const;
type Category = (typeof CATEGORIES)[number];
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

  if (isLoading || !isAuthenticated || !me) return <p className="muted">Loading your account…</p>;
  const tabs: [Tab, string][] = [["browse", "Browse tools"], ["listings", "My listings"], ["requests", "My requests"], ["incoming", "Incoming requests"]];
  if (me.role === "admin") tabs.push(["admin", "Admin"]);

  return (
    <>
      <h2>Hi {me.name} {me.role === "admin" && <span className="tag">admin</span>} {me.trustedLender && <span className="tag">trusted lender</span>}</h2>
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
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
      <select value={category} onChange={(e) => setCategory(e.target.value as Category | "")} style={{ maxWidth: 220, marginBottom: 12 }}>
        <option value="">All categories</option>
        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
      </select>
      {rq.error && <p className="err">{rq.error}</p>}
      {rm.error && <p className="err">{rm.error}</p>}
      <div className="grid">
        {tools?.map((t) => (
          <div className="card" key={t._id}>
            <h3>{t.name}</h3>
            <span className="tag">{t.category}</span>
            <span className={t.status === "available" ? "tag" : "tag warn"}>{t.status === "available" ? "available" : "on loan"}</span>
            <p className="muted">{t.condition} · {t.description}</p>
            <p className="muted">Lender: {t.ownerName}{t.ownerTrusted ? " ✓ trusted" : ""}</p>
            <div className="actions">
              {!t.isMine && t.status === "available" && <button className="ghost" onClick={() => setOpen(open === t._id ? null : t._id)}>Request</button>}
              {isAdmin && <button className="danger" onClick={() => rm.run(t._id)}>Remove (admin)</button>}
            </div>
            {open === t._id && (
              <div style={{ marginTop: 8 }}>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ marginTop: 6 }} />
                <div className="actions">
                  <button disabled={!start || !end} onClick={async () => { if (await rq.run(t._id)) setOpen(null); }}>Send request</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {tools?.length === 0 && <p className="muted">No tools in this category.</p>}
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
  return (
    <>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await c.run()) setF({ ...f, name: "", description: "" }); }}>
        <input required placeholder="Tool name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category })}>
          {CATEGORIES.map((x) => <option key={x}>{x}</option>)}
        </select>
        <input required placeholder="Condition" maxLength={60} value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} />
        <input placeholder="Short description" maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <button type="submit">List tool</button>
      </form>
      {c.error && <p className="err">{c.error}</p>}
      {r.error && <p className="err">{r.error}</p>}
      <div className="grid">
        {tools?.map((t) => (
          <div className="card" key={t._id}>
            <h3>{t.name}</h3>
            <span className="tag">{t.category}</span><span className="tag">{t.status}</span>
            <p className="muted">{t.condition} · {t.description}</p>
            <div className="actions"><button className="danger" onClick={() => r.run(t._id)}>Delete</button></div>
          </div>
        ))}
      </div>
      {tools?.length === 0 && <p className="muted">You have not listed anything yet.</p>}
    </>
  );
}

function ago(ts: number) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d >= 1) return `${d} day${d > 1 ? "s" : ""} ago`;
  const h = Math.floor((Date.now() - ts) / 3600000);
  return h >= 1 ? `${h}h ago` : "just now";
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
      <div className="grid">
        {rows?.map((r) => (
          <div className="card" key={r._id}>
            <h3>{r.toolName}</h3>
            <span className="tag">{r.status}</span>
            <p className="muted">{r.startDate} → {r.endDate}</p>
            <p className="muted">Borrower: {r.borrowerName} · Lender: {r.lenderName}</p>
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
      {rows?.length === 0 && <p className="muted">Nothing here yet.</p>}
    </>
  );
}

function Admin() {
  const users = useQuery(api.users.listForAdmin);
  const loans = useQuery(api.requests.allLoans);
  const setTrusted = useMutation(api.users.setTrustedLender);
  const t = useAction(async (userId: Id<"users">, trusted: boolean) => setTrusted({ userId, trusted }));
  return (
    <>
      <h3>Lenders</h3>
      {t.error && <p className="err">{t.error}</p>}
      <div className="grid">
        {users?.map((u) => (
          <div className="card" key={u._id}>
            <h3>{u.name}</h3>
            <span className="tag">{u.role}</span>{u.trustedLender && <span className="tag">trusted lender</span>}
            <div className="actions">
              <button className="ghost" onClick={() => t.run(u._id, !u.trustedLender)}>{u.trustedLender ? "Remove trusted" : "Mark trusted lender"}</button>
            </div>
          </div>
        ))}
      </div>
      <h3>All loans</h3>
      <RequestList rows={loans} mode="all" />
    </>
  );
  }
