import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import "./globals.css";

const font = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font" });

export const metadata: Metadata = {
  title: "LendLoop",
  description: "Borrow what you need. Lend what you don't.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#1f4d45" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={font.variable}>
        <body>
          <ConvexClientProvider>
            <header className="topbar">
              <Link href="/" className="brand" aria-label="LendLoop home">
                <span className="logo" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M17 7a7 7 0 1 0 2 5" /><path d="M19 3v4h-4" /></svg>
                </span>
                LendLoop
              </Link>
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <button className="btn primary sm">Sign in</button>
                </SignInButton>
              </Show>
              <Show when="signed-in">
                <nav className="top-links">
                  <Link href="/dashboard">Dashboard</Link>
                  <UserButton />
                </nav>
              </Show>
            </header>
            <main>{children}</main>
            <footer className="foot">LendLoop · neighbors sharing tools</footer>
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
