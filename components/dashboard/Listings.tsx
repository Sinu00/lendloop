"use client";
// My listings: the lender's own tools. One sheet handles both "List a tool" and "Edit".
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Icon from "@/components/Icon";
import { CATEGORIES, type Category, ConfirmButton, Empty, ErrorNote, Sheet, Skeletons, StatusPill, ToolTile, cap, useAction } from "@/components/ui";

type Draft = { toolId?: Id<"tools">; name: string; category: Category; condition: string; description: string };
const BLANK: Draft = { name: "", category: "power tools", condition: "Good", description: "" };
const CONDITIONS = ["Like new", "Good", "Fair", "Well used"];

export default function Listings() {
  const tools = useQuery(api.tools.mine);
  const remove = useMutation(api.tools.remove);
  const [draft, setDraft] = useState<Draft | null>(null);
  const r = useAction(async (toolId: Id<"tools">) => remove({ toolId }));

  return (
    <section aria-labelledby="listings-h">
      <div className="page-head">
        <div>
          <h2 id="listings-h">My listings</h2>
          <p className="muted">Tools you are happy to lend. You approve every request.</p>
        </div>
        <button className="btn primary" onClick={() => setDraft({ ...BLANK })}><Icon name="plus" size={18} /> List a tool</button>
      </div>
      <ErrorNote text={r.error} />
      {tools === undefined && <Skeletons n={2} />}
      <div className="list">
        {tools?.map((t) => (
          <article className="card row-card" key={t._id}>
            <ToolTile category={t.category} size="sm" />
            <div className="row-main">
              <h3>{t.name}</h3>
              <div className="tags"><span className="pill pill-cat">{cap(t.category)}</span><StatusPill status={t.status} /></div>
              <p className="muted">{t.condition}{t.description ? ` · ${t.description}` : ""}</p>
            </div>
            <div className="row-actions">
              <button className="btn ghost" onClick={() => setDraft({ toolId: t._id, name: t.name, category: t.category, condition: t.condition, description: t.description })}>
                <Icon name="edit" size={16} /> Edit
              </button>
              {t.status === "on_loan"
                ? <span className="muted small">On loan: can&apos;t delete</span>
                : <ConfirmButton label="Delete" confirmLabel="Delete listing" onConfirm={() => r.run(t._id)} />}
            </div>
          </article>
        ))}
      </div>
      {tools?.length === 0 && (
        <Empty icon="other" title="You have not listed anything yet" text="A drill, a ladder, a tent: anything you rarely use helps a neighbor.">
          <button className="btn primary" onClick={() => setDraft({ ...BLANK })}><Icon name="plus" size={18} /> List your first tool</button>
        </Empty>
      )}
      {draft && <ToolForm draft={draft} onClose={() => setDraft(null)} />}
    </section>
  );
}

function ToolForm({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [f, setF] = useState<Draft>(draft);
  const editing = !!draft.toolId;
  const save = useAction(async () => {
    const body = { name: f.name, category: f.category, condition: f.condition, description: f.description };
    return editing ? update({ toolId: f.toolId!, ...body }) : create(body);
  });

  return (
    <Sheet title={editing ? "Edit listing" : "List a tool"} onClose={onClose}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); if (await save.run()) onClose(); }}>
        <label className="field">Name
          <input required placeholder="Tool name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="field">Category
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category })}>
            {CATEGORIES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}
          </select>
        </label>
        <fieldset className="field">
          <legend>Condition</legend>
          <div className="seg">
            {CONDITIONS.map((c) => (
              <label key={c} className="seg-opt">
                <input type="radio" name="condition" value={c} checked={f.condition === c} onChange={() => setF({ ...f, condition: c })} />
                <span>{c}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">Description
          <textarea placeholder="Short description" maxLength={300} rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <span className="hint">{f.description.length}/300 · what&apos;s included, any quirks</span>
        </label>
        <ErrorNote text={save.error} />
        <button className="btn primary block lg" type="submit" disabled={save.busy}>{editing ? "Save changes" : "List tool"}</button>
      </form>
    </Sheet>
  );
}
