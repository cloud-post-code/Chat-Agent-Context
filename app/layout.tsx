import type { Metadata } from "next";
import { Playfair_Display, Lora, JetBrains_Mono } from "next/font/google";
import { siteOrigin } from "@/lib/util";
import { PostHogProvider } from "./PostHogProvider";
import "./globals.css";

// Body + mono are fixed. The heading font default is Playfair Display (the
// Main Street serif). Per-tenant theme overrides are injected by the routes
// that belong to one tenant — the public agent page (/a/[slug]) and the admin
// dashboard — not here: the root layout wraps every tenant plus the
// directory, so it stays on the defaults.
const headingDefault = Playfair_Display({ subsets: ["latin"], variable: "--font-heading", display: "swap" });
const body = Lora({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  // Absolute base for the share image URL — scrapers reject relative og:image.
  metadataBase: new URL(siteOrigin()),
  title: "Main Street",
  description: "The joy of Main Street, delivered to your door. Every agent has an owner, every owner has an agent page.",
  openGraph: {
    title: "Main Street",
    description: "The joy of Main Street, delivered to your door. Every agent has an owner, every owner has an agent page.",
    type: "website",
  },
  // The image itself comes from app/opengraph-image.tsx (file-based metadata).
  twitter: { card: "summary_large_image" },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${headingDefault.variable} ${body.variable} ${mono.variable}`}
    >
      <body>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
