"use client";
// Admin: automation health, lenders (Trusted Lender toggle) and every loan.
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Icon from "@/components/Icon";
import { ErrorNote, ago, useAction } from "@/components/ui";
import { LoanList } from "./Requests";

export default function Admin() {
  const users = useQuery(api.users.listForAdmin);
  const loans = useQuery(api.requests.allLoans);
  const issues = useQuery(api.requests.automationIssues);
  const setTrusted = useMutation(api.users.setTrustedLender);
  const t = useAction(async (userId: Id<"users">, trusted: boolean) => setTrusted({ userId, trusted }));

  return (
    <section aria-labelledby="admin-h" className="admin">
      <div className="page-head"><div><h2 id="admin-h">Admin</h2><p className="muted">Keep the neighborhood running smoothly.</p></div></div>

      <div className="card health">
        <div className="health-head">
          <span className={`health-dot${issues?.length ? " bad" : ""}`} />
          <div>
            <h3>Automation health</h3>
            <p className="muted">
              {issues === undefined ? "Checking…" : issues.length ? `${issues.length} recent problem${issues.length === 1 ? "" : "s"} with n8n or notifications` : "No n8n failures or undelivered notifications."}
            </p>
          </div>
        </div>
        {issues && issues.length > 0 && (
          <ul className="issues">
            {issues.map((l) => (
              <li key={l._id}>
                <span className="pill pill-overdue">{l.type === "automation_failure" ? "n8n run failed" : "Not delivered"}</span>
                <span>{l.summary}</span>
                <span className="muted small">{ago(l.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="row-head"><h3>Lenders</h3>{users && <span className="muted">{users.length}</span>}</div>
      <ErrorNote text={t.error} />
      <div className="card people">
        {users?.map((u) => (
          <div className="person" key={u._id}>
            <span className="avatar">{u.name.slice(0, 1).toUpperCase()}</span>
            <div className="row-main">
              <b>{u.name}</b>
              <span className="muted small">
                {u.role === "admin" ? "Admin" : "Neighbor"}
                {u.trustedLender && <> · <Icon name="trusted" size={13} /> Trusted lender</>}
              </span>
            </div>
            <button className={`btn ${u.trustedLender ? "ghost" : "soft"}`} onClick={() => t.run(u._id, !u.trustedLender)}>
              {u.trustedLender ? "Remove trusted" : "Mark trusted"}
            </button>
          </div>
        ))}
      </div>

      <div className="row-head"><h3>All loans</h3>{loans && <span className="muted">{loans.length}</span>}</div>
      <LoanList rows={loans} mode="all" />
    </section>
  );
}
