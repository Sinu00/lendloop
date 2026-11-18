import type { Metadata } from "next";
import { ClerkProvider, Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "LendLoop",
  description: "Borrow what you need. Lend what you don't.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <ConvexClientProvider>
            <header className="top">
              <Link href="/" className="brand">LendLoop</Link>
              <Show when="signed-in">
                <nav style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <Link href="/dashboard">Dashboard</Link>
                  <UserButton />
                </nav>
              </Show>
            </header>
            <main>{children}</main>
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
