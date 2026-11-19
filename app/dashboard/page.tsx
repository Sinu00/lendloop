"use client";
// Signed-in shell: greeting, "right now" card, and the five views. Bottom tab bar on phones, top tabs on wider screens.
import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Icon from "@/components/Icon";
import { Skeletons, firstName } from "@/components/ui";
import Browse from "@/components/dashboard/Browse";
import Listings from "@/components/dashboard/Listings";
import { Incoming, MyRequests, NowCard } from "@/components/dashboard/Requests";
import Admin from "@/components/dashboard/Admin";

type Tab = "browse" | "listings" | "requests" | "incoming" | "admin";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const ready = isAuthenticated && !!me;
  const incoming = useQuery(api.requests.incoming, ready ? {} : "skip");
  const mine = useQuery(api.requests.myRequests, ready ? {} : "skip");
  const [tab, setTab] = useState<Tab>("browse");

  useEffect(() => {
    if (isAuthenticated) void ensure();
  }, [isAuthenticated, ensure]);
  useEffect(() => {
    window.scrollTo({ top: 0 }); // block body: newer browsers return a Promise from scrollTo
  }, [tab]);

  if (isLoading || !isAuthenticated || !me) return <Skeletons />;
  const pendingIn = incoming?.filter((r) => r.status === "pending").length ?? 0;

  const tabs: { k: Tab; label: string; icon: string; badge?: number }[] = [
    { k: "browse", label: "Browse", icon: "compass" },
    { k: "listings", label: "Listings", icon: "other" },
    { k: "requests", label: "Requests", icon: "send" },
    { k: "incoming", label: "Incoming", icon: "inbox", badge: pendingIn },
  ];
  if (me.role === "admin") tabs.push({ k: "admin", label: "Admin", icon: "shield" });

  return (
    <div className="dash">
      <nav className="tabbar" aria-label="Sections">
        {tabs.map((t) => (
          <button key={t.k} className="tab" aria-current={tab === t.k ? "page" : undefined} onClick={() => setTab(t.k)}>
            <span className="tab-ico">
              <Icon name={t.icon} size={22} />
              {!!t.badge && <span className="badge" aria-label={`${t.badge} waiting`}>{t.badge}</span>}
            </span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {tab === "browse" && (
        <header className="hello">
          <p className="muted">{greeting()}, {firstName(me.name)}{me.trustedLender ? " · trusted lender" : ""}</p>
          <h1>What do you need to borrow?</h1>
        </header>
      )}
      {tab === "browse" && <NowCard mine={mine} incoming={incoming} go={setTab} />}

      {tab === "browse" && <Browse isAdmin={me.role === "admin"} />}
      {tab === "listings" && <Listings />}
      {tab === "requests" && <MyRequests />}
      {tab === "incoming" && <Incoming />}
      {tab === "admin" && me.role === "admin" && <Admin />}
    </div>
  );
}
