"use client";
// Loan cards for My requests, Incoming requests and the admin's All loans, with a status stepper and activity.
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Icon from "@/components/Icon";
import { Empty, ErrorNote, Skeletons, StatusPill, ToolTile, ago, daysBetween, firstName, fmtDate, todayIso, useAction } from "@/components/ui";

export type Loan = NonNullable<ReturnType<typeof useQuery<typeof api.requests.myRequests>>>[number];
type Mode = "mine" | "incoming" | "all";

export const isOverdue = (r: Loan) => r.status === "approved" && r.endDate < todayIso();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Activity entries in neighbor language; the raw n8n wording stays in the database and the admin view. */
function friendly(l: Loan["recentActivity"][number]) {
  if (l.type === "notification_sent") return "Neighbor notified by email";
  if (l.type === "notification_failed") return "Email could not be sent (admin alerted)";
  if (l.type === "reminder_sent") return "Return reminder sent";
  if (l.type === "request_created") return "Request sent";
  const m = l.summary.match(/Status changed to (\w+)/);
  return m ? `Marked ${m[1]}` : l.summary;
}

const STEPS = ["Requested", "Approved", "Returned"];
function Stepper({ status }: { status: Loan["status"] }) {
  const ended = status === "declined" || status === "cancelled";
  const at = status === "pending" ? 0 : status === "approved" ? 1 : status === "returned" ? 2 : 0;
  return (
    <ol className={`stepper${ended ? " ended" : ""}`} aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className={i <= at && !(ended && i > 0) ? "done" : ""}>
          <span className="dot">{i <= at && !(ended && i > 0) ? <Icon name="check" size={12} stroke={3} /> : null}</span>
          <span>{ended && i === 1 ? (status === "declined" ? "Declined" : "Cancelled") : s}</span>
        </li>
      ))}
    </ol>
  );
}

export function LoanCard({ r, mode }: { r: Loan; mode: Mode }) {
  const approve = useMutation(api.requests.approve);
  const decline = useMutation(api.requests.decline);
  const returned = useMutation(api.requests.markReturned);
  const cancel = useMutation(api.requests.cancel);
  const a = useAction(async (fn: "approve" | "decline" | "returned" | "cancel", id: Id<"borrowRequests">) => {
    await { approve, decline, returned, cancel }[fn]({ requestId: id });
  });
  const overdue = isOverdue(r);
  const other = mode === "incoming" ? r.borrowerName : mode === "mine" ? r.lenderName : `${r.borrowerName} borrowing from ${r.lenderName}`;
  const days = daysBetween(r.startDate, r.endDate) + 1;

  return (
    <article className={`card loan${overdue ? " overdue" : ""}`}>
      <div className="loan-top">
        <ToolTile category={r.toolCategory} size="sm" />
        <div className="row-main">
          <h3>{r.toolName}</h3>
          <p className="muted">
            {mode === "incoming" ? "Requested by " : mode === "mine" ? "Lent by " : ""}<b>{other}</b>
          </p>
        </div>
        <StatusPill status={overdue ? "overdue" : r.status} />
      </div>
      <p className="when">
        <Icon name="calendar" size={16} /> {fmtDate(r.startDate)} → {fmtDate(r.endDate)} <span className="muted">· {days} day{days > 1 ? "s" : ""}</span>
      </p>
      {overdue && (
        <p className="warn-line"><Icon name="alert" size={16} /> {plural(daysBetween(r.endDate, todayIso()), "day")} late{r.reminderCount ? ` · ${r.reminderCount} reminder${r.reminderCount > 1 ? "s" : ""} sent` : ""}</p>
      )}
      <Stepper status={r.status} />
      <ErrorNote text={a.error} />
      {mode === "incoming" && r.status === "pending" && (
        <div className="btn-row">
          <button className="btn primary" disabled={a.busy} onClick={() => a.run("approve", r._id)}><Icon name="check" size={18} /> Approve</button>
          <button className="btn ghost" disabled={a.busy} onClick={() => a.run("decline", r._id)}>Decline</button>
        </div>
      )}
      {mode === "incoming" && r.status === "approved" && (
        <div className="btn-row"><button className="btn primary" disabled={a.busy} onClick={() => a.run("returned", r._id)}>Mark returned</button></div>
      )}
      {mode === "mine" && r.status === "pending" && (
        <div className="btn-row"><button className="btn ghost" disabled={a.busy} onClick={() => a.run("cancel", r._id)}>Cancel request</button></div>
      )}
      {r.recentActivity.length > 0 && (
        <details className="activity">
          <summary><Icon name="activity" size={15} /> {friendly(r.recentActivity[0])} · {ago(r.recentActivity[0].at)}</summary>
          <ul>{r.recentActivity.map((l, i) => <li key={i}>{friendly(l)} <span className="muted">· {ago(l.at)}</span></li>)}</ul>
        </details>
      )}
    </article>
  );
}

export function LoanList({ rows, mode }: { rows: Loan[] | undefined; mode: Mode }) {
  if (rows === undefined) return <Skeletons n={2} />;
  if (rows.length === 0) {
    return mode === "incoming"
      ? <Empty icon="inbox" title="No requests yet" text="When a neighbor asks to borrow one of your tools, it shows up here for you to approve." />
      : mode === "mine"
      ? <Empty icon="send" title="You haven't borrowed anything yet" text="Find a tool in Browse and ask for the dates you need." />
      : <Empty icon="list" title="No loans yet" text="Loans between neighbors will appear here." />;
  }
  // Things that need attention first: overdue, then pending, then active, then the rest.
  const rank = (r: Loan) => (isOverdue(r) ? 0 : r.status === "pending" ? 1 : r.status === "approved" ? 2 : 3);
  const sorted = rows.slice().sort((a, b) => rank(a) - rank(b));
  return <div className="list two">{sorted.map((r) => <LoanCard key={r._id} r={r} mode={mode} />)}</div>;
}

export function MyRequests() {
  const rows = useQuery(api.requests.myRequests);
  return (
    <section aria-labelledby="mine-h">
      <div className="page-head"><div><h2 id="mine-h">My requests</h2><p className="muted">Tools you asked to borrow.</p></div></div>
      <LoanList rows={rows} mode="mine" />
    </section>
  );
}

export function Incoming() {
  const rows = useQuery(api.requests.incoming);
  const pending = rows?.filter((r) => r.status === "pending").length ?? 0;
  return (
    <section aria-labelledby="in-h">
      <div className="page-head">
        <div>
          <h2 id="in-h">Incoming requests</h2>
          <p className="muted">{pending ? `${pending} neighbor${pending > 1 ? "s are" : " is"} waiting for your answer.` : "Requests to borrow your tools."}</p>
        </div>
      </div>
      <LoanList rows={rows} mode="incoming" />
    </section>
  );
}

/** Home banner: what is borrowed right now and what needs an answer. Homely-style status card. */
export function NowCard({ mine, incoming, go }: { mine: Loan[] | undefined; incoming: Loan[] | undefined; go: (t: "requests" | "incoming") => void }) {
  const late = mine?.find(isOverdue);
  const active = late ?? mine?.find((r) => r.status === "approved");
  const waiting = incoming?.filter((r) => r.status === "pending").length ?? 0;
  const lentLate = incoming?.filter(isOverdue).length ?? 0;
  if (!active && !waiting && !lentLate) return null;
  return (
    <div className="now">
      {active && (
        <button className={`now-card${late ? " late" : ""}`} onClick={() => go("requests")}>
          <span className="now-label">{late ? "Please return" : "You're borrowing"}</span>
          <b>{active.toolName}</b>
          <span>{late ? `Was due ${fmtDate(active.endDate)} · ${firstName(active.lenderName)} is waiting` : `Back to ${firstName(active.lenderName)} by ${fmtDate(active.endDate)}`}</span>
          <Icon name="arrow" size={18} />
        </button>
      )}
      {(waiting > 0 || lentLate > 0) && (
        <button className="now-card alt" onClick={() => go("incoming")}>
          <span className="now-label">Lending</span>
          <b>{waiting > 0 ? `${waiting} request${waiting > 1 ? "s" : ""} to answer` : `${lentLate} tool${lentLate > 1 ? "s" : ""} overdue`}</b>
          <span>{waiting > 0 ? "Neighbors are waiting for a yes or no" : "We sent the borrower a reminder"}</span>
          <Icon name="arrow" size={18} />
        </button>
      )}
    </div>
  );
}
