"use client";
// Public page = the tool board. Signed-out visitors see what neighbors are lending (name + category only)
// and sign in to borrow. Signed-in visitors go straight to their dashboard.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import Icon from "@/components/Icon";
import { type Category, Empty, Sheet, Skeletons, ToolTile, cap } from "@/components/ui";
import { CategoryChips } from "@/components/dashboard/Browse";

export default function Home() {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (isSignedIn) router.replace("/dashboard");
  }, [isSignedIn, router]);

  // Public query: name + category of available tools only. No owner, no description.
  const tools = useQuery(api.tools.listPublic);
  const [category, setCategory] = useState<Category | "">("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ name: string; category: string } | null>(null);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tools?.filter((t) => (!category || t.category === category) && (!needle || t.name.toLowerCase().includes(needle)));
  }, [tools, category, q]);

  return (
    <div className="board">
      <header className="board-head">
        <h1>Borrow what you need. Lend what you don&apos;t.</h1>
        <p className="muted">Free tool sharing between neighbors{tools ? ` · ${tools.length} tools available now` : ""}</p>
      </header>

      <label className="search">
        <Icon name="search" size={20} />
        <input type="search" placeholder="Search drills, ladders, tents…" aria-label="Search tools" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <CategoryChips value={category} onChange={setCategory} />

      <div className="row-head">
        <h2>{category ? cap(category) : "Available now"}</h2>
        {shown && <span className="muted">{shown.length} tool{shown.length === 1 ? "" : "s"}</span>}
      </div>
      {shown === undefined && <Skeletons />}
      <div className="grid">
        {shown?.map((t) => (
          <button key={t._id} className="tool-card" onClick={() => setPicked(t)} aria-label={`${t.name}, ${t.category}`}>
            <ToolTile category={t.category} />
            <span className="tool-name">{t.name}</span>
            <span className="tool-meta">{cap(t.category)}</span>
          </button>
        ))}
      </div>
      {shown?.length === 0 && (
        <Empty icon="search" title={tools?.length ? "Nothing matches" : "Nothing listed yet"} text={tools?.length ? "Try another word or category." : "Be the first neighbor to lend something."} />
      )}

      <div className="lend-cta card">
        <span className="tile tile-sm" data-cat="power tools"><Icon name="plus" size={22} /></span>
        <div><b>Got a tool you rarely use?</b><span className="muted">List it in a minute. You approve every loan.</span></div>
        <SignInButton mode="modal"><button className="btn ghost">Sign in to lend</button></SignInButton>
      </div>

      {picked && (
        <Sheet title={picked.name} onClose={() => setPicked(null)}>
          <ToolTile category={picked.category} size="lg" />
          <div className="tags"><span className="pill pill-cat">{cap(picked.category)}</span><span className="pill pill-available">Available</span></div>
          <p className="note">Sign in to see who&apos;s lending it, its condition, and to pick your dates.</p>
          <div style={{ marginTop: 16 }}>
            <SignInButton mode="modal"><button className="btn primary block lg">Sign in to borrow</button></SignInButton>
          </div>
        </Sheet>
      )}
    </div>
  );
}
