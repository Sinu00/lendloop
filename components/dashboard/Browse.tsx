"use client";
// Browse: search + category chips + tool grid. Tapping a tool opens a sheet with details and the request form.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Icon from "@/components/Icon";
import {
  CATEGORIES, type Category, ConfirmButton, Empty, ErrorNote, Sheet, Skeletons, StatusPill, ToolTile,
  cap, daysBetween, firstName, todayIso, useAction,
} from "@/components/ui";

type Tool = NonNullable<ReturnType<typeof useQuery<typeof api.tools.listAll>>>[number];

export function CategoryChips({ value, onChange }: { value: Category | ""; onChange: (c: Category | "") => void }) {
  return (
    <div className="chips" role="group" aria-label="Category">
      {(["", ...CATEGORIES] as const).map((c) => (
        <button key={c || "all"} className="chip" data-cat={c || "all"} aria-pressed={value === c} onClick={() => onChange(c)}>
          <span className="chip-ico"><Icon name={c || "all"} size={20} /></span>
          <span>{c ? cap(c) : "All"}</span>
        </button>
      ))}
    </div>
  );
}

export default function Browse({ isAdmin }: { isAdmin: boolean }) {
  const [category, setCategory] = useState<Category | "">("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<Id<"tools"> | null>(null);
  const tools = useQuery(api.tools.listAll, category ? { category } : {});

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle ? tools?.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(needle)) : tools;
    // Available first, then on loan; stable by name.
    return rows?.slice().sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "available" ? -1 : 1));
  }, [tools, q]);
  const open = tools?.find((t) => t._id === openId) ?? null;

  return (
    <section aria-labelledby="browse-h">
      <h2 id="browse-h" className="sr-only">Browse tools</h2>
      <label className="search">
        <Icon name="search" size={20} />
        <input type="search" placeholder="Search drills, ladders, tents…" aria-label="Search tools" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <CategoryChips value={category} onChange={setCategory} />
      <div className="row-head">
        <h3>{category ? cap(category) : "All tools"}</h3>
        {shown && <span className="muted">{shown.length} tool{shown.length === 1 ? "" : "s"}</span>}
      </div>
      {shown === undefined && <Skeletons />}
      <div className="grid">
        {shown?.map((t) => (
          <button key={t._id} className="tool-card" onClick={() => setOpenId(t._id)} aria-label={`${t.name}, ${t.status === "available" ? "available" : "on loan"}`}>
            <ToolTile category={t.category}>
              {t.status !== "available" && <span className="tile-badge"><StatusPill status={t.status} /></span>}
              {t.isMine && <span className="tile-badge right"><span className="pill pill-mine">Yours</span></span>}
            </ToolTile>
            <span className="tool-name">{t.name}</span>
            <span className="tool-meta">
              {t.condition} · {firstName(t.ownerName)}
              {t.ownerTrusted && <span className="trusted" title="Trusted lender"><Icon name="trusted" size={15} /></span>}
            </span>
          </button>
        ))}
      </div>
      {shown?.length === 0 && (
        <Empty
          icon="search"
          title={q ? `Nothing matches “${q}”` : "No tools here yet"}
          text={q || category ? "Try another word or category, or list something yourself." : "Nobody has listed a tool yet. Add yours from Listings."}
        />
      )}
      {open && <ToolSheet tool={open} isAdmin={isAdmin} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function ToolSheet({ tool, isAdmin, onClose }: { tool: Tool; isAdmin: boolean; onClose: () => void }) {
  const request = useMutation(api.requests.create);
  const remove = useMutation(api.tools.remove);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sent, setSent] = useState(false);
  const rq = useAction(async () => request({ toolId: tool._id, startDate: start, endDate: end }));
  const rm = useAction(async () => remove({ toolId: tool._id }));
  const days = start && end && end >= start ? daysBetween(start, end) + 1 : 0;

  return (
    <Sheet title={tool.name} onClose={onClose}>
      <ToolTile category={tool.category} size="lg" />
      <div className="tags">
        <span className="pill pill-cat">{cap(tool.category)}</span>
        <StatusPill status={tool.status} />
        <span className="pill pill-soft">Condition: {tool.condition}</span>
      </div>
      {tool.description && <p className="desc">{tool.description}</p>}
      <div className="lender">
        <span className="avatar">{tool.ownerName.slice(0, 1).toUpperCase()}</span>
        <div>
          <b>{tool.ownerName}</b>
          <span className="muted">{tool.ownerTrusted ? "Trusted lender in your neighborhood" : "Neighbor"}</span>
        </div>
        {tool.ownerTrusted && <span className="trusted big"><Icon name="trusted" size={22} /></span>}
      </div>

      {tool.isMine ? (
        <p className="note">This is your listing. Manage it from <b>Listings</b>.</p>
      ) : sent ? (
        <div className="success" role="status">
          <Icon name="check" size={22} />
          <div><b>Request sent</b><span>{firstName(tool.ownerName)} will get a notification. Track it under Requests.</span></div>
        </div>
      ) : tool.status !== "available" ? (
        <p className="note">This tool is out on loan right now. Check back once it is returned.</p>
      ) : (
        <form className="request-form" onSubmit={async (e) => { e.preventDefault(); if (await rq.run()) setSent(true); }}>
          <h3>When do you need it?</h3>
          <div className="dates">
            <label className="field">From
              <input type="date" required min={todayIso()} value={start} onChange={(e) => { setStart(e.target.value); if (end && end < e.target.value) setEnd(""); }} />
            </label>
            <label className="field">Until
              <input type="date" required min={start || todayIso()} value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <ErrorNote text={rq.error} />
          <button className="btn primary block lg" type="submit" disabled={!start || !end || rq.busy}>
            Send request{days ? ` · ${days} day${days > 1 ? "s" : ""}` : ""}
          </button>
          <p className="muted center">Free between neighbors. {firstName(tool.ownerName)} approves every loan.</p>
        </form>
      )}

      {isAdmin && !tool.isMine && (
        <div className="admin-zone">
          <span className="muted"><Icon name="shield" size={15} /> Admin</span>
          <ErrorNote text={rm.error} />
          <ConfirmButton label="Remove listing (admin)" confirmLabel="Remove listing" block onConfirm={async () => { if (await rm.run()) onClose(); }} />
        </div>
      )}
    </Sheet>
  );
}
