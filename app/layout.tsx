import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { brand, themeOverrideCss, type ThemeColors } from "@/lib/theme";
import { headingFamily, bodyFamily } from "@/lib/fonts";
import { getThemeConfig } from "@/lib/db";
import { safeJson, siteOrigin } from "@/lib/util";
import { PostHogProvider } from "./PostHogProvider";
import "./globals.css";

// Body + mono are fixed. The heading font default is Space Grotesk, but the
// admin-chosen font/colors are injected as an override <style> below.
const headingDefault = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  // Absolute base for the share image URL — scrapers reject relative og:image.
  metadataBase: new URL(siteOrigin()),
  title: `${brand.name} — ${brand.tagline}`,
  description: `Blake's personal website. Chat with an AI host about his projects, background, and recent work.`,
  openGraph: {
    title: `${brand.name} — ${brand.tagline}`,
    description: `Blake's personal website. Chat with an AI host about his projects, background, and recent work.`,
    type: "website",
  },
  // The image itself comes from app/opengraph-image.tsx (file-based metadata).
  twitter: { card: "summary_large_image" },
};

// The <head> theme override is DB-driven and wraps every route, so always
// render it fresh — a stale layout cache would leave the whole site mis-themed.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the admin-controlled theme so the whole site restyles from the DB.
  const theme = await getThemeConfig().catch(() => null);
  const colors = safeJson<ThemeColors>(theme?.themeColors ?? "{}", {});
  const override = themeOverrideCss({
    headingFamily: headingFamily(theme?.themeFont ?? "space-grotesk"),
    bodyFamily: bodyFamily(theme?.themeBodyFont ?? "inter"),
    radius: theme?.themeRadius ?? "rounded",
    fontSize: theme?.themeFontSize ?? "",
    headingWeight: theme?.themeHeadingWeight ?? "",
    colors,
  });

  return (
    <html
      lang="en"
      className={`${headingDefault.variable} ${body.variable} ${mono.variable}`}
    >
      <head>
        {/* DB-backed theme override — wins over globals.css :root defaults. */}
        <style dangerouslySetInnerHTML={{ __html: override }} />
      </head>
      <body>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
