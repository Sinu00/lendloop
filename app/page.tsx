"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { SignInButton, Show } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";

export default function Home() {
  // Public query: returns name + category of available tools only (no owner details).
  const tools = useQuery(api.tools.listPublic);
  return (
    <>
      <section className="hero">
        <h1>LendLoop</h1>
        <p>Borrow what you need. Lend what you don&apos;t.</p>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button>Sign in to lend or borrow</button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Link className="btn" href="/dashboard">Go to your dashboard</Link>
        </Show>
      </section>
      <h2>Available tools</h2>
      {tools === undefined && <p className="muted">Loading…</p>}
      {tools?.length === 0 && <p className="muted">Nothing listed yet. Be the first to lend something.</p>}
      <div className="grid">
        {tools?.map((t) => (
          <div className="card" key={t._id}>
            <h3>{t.name}</h3>
            <span className="tag">{t.category}</span>
          </div>
        ))}
      </div>
    </>
  );
}
