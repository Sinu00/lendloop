"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { SignInButton, Show } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import Icon from "@/components/Icon";


export default function Home() {
  // Public query: returns name + category of available tools only (no owner details).
  const tools = useQuery(api.tools.listPublic);
  return (
    <>
      <section className="hero">
        <span className="eyebrow">Neighborhood tool lending</span>
        <h1>Borrow what you need.<br />Lend what you don&apos;t.</h1>
        <p>Skip buying a drill you&apos;ll use twice. Neighbors share tools, you approve every loan, and nothing sits unused in a garage.</p>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="lg">Sign in to lend or borrow</button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Link className="btn lg" href="/dashboard">Go to your dashboard</Link>
        </Show>
      </section>
      <div className="steps">
        <div className="step"><span className="n">1</span><b>List a tool</b><span className="muted">Add what you&apos;re happy to lend.</span></div>
        <div className="step"><span className="n">2</span><b>Request dates</b><span className="muted">Neighbors ask to borrow for set dates.</span></div>
        <div className="step"><span className="n">3</span><b>Approve and return</b><span className="muted">You decide, then mark it returned.</span></div>
      </div>
      <div className="section-head">
        <h2>Available tools</h2>
        {tools && <span className="muted">{tools.length} available now</span>}
      </div>
      {tools === undefined && <div className="grid"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>}
      {tools?.length === 0 && (
        <div className="empty"><div className="big"><Icon name="other" size={34} /></div><h3>Nothing listed yet</h3><p>Be the first neighbor to lend something.</p></div>
      )}
      <div className="grid">
        {tools?.map((t) => (
          <div className="card" key={t._id}>
            <div className="top">
              <span className="ico"><Icon name={t.category} /></span>
              <div><h3>{t.name}</h3><div className="tags"><span className="tag">{t.category}</span></div></div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
