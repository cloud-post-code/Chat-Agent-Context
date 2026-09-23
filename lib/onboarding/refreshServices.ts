import { prisma } from "@/lib/db";
import { onboardingIngestKind } from "@/lib/ingestionSources";
import { SERVICES_SOURCE_TITLE } from "@/lib/serviceCatalog";
import { Crawler } from "./crawl";
import { isBookingHost } from "./bookingPage";
import { discoverServicePages, extractServicesAndBooking } from "./services";
import { enrichServices } from "./bookingSeed";

/**
 * Re-read the business's site for its services — the same stage onboarding
 * runs, on demand from the admin — and fill in what the tenant's services
 * are still missing: prices, durations, descriptions, add-ons, deposits,
 * policies and photos. Knowledge, the menu and an untouched intake form are
 * refreshed the way onboarding refreshes them; services the owner has
 * already edited keep every value they set (lib/onboarding/bookingSeed.ts
 * enrichServices). Needs the model key, like onboarding.
 */

export type RefreshResult =
  | { ok: true; services: number; updated: number; added: number; imaged: number; site: string }
  | { ok: false; error: string };

/** The site onboarding read, recovered from the records it saved. */
export async function siteUrlFor(userId: string): Promise<string | null> {
  const services = await prisma.source.findFirst({
    where: { userId, kind: onboardingIngestKind("services"), title: SERVICES_SOURCE_TITLE },
    orderBy: { updatedAt: "desc" },
    select: { url: true },
  });
  const others = await prisma.source.findMany({
    where: { userId, kind: { startsWith: "ingest:" }, url: { startsWith: "http" } },
    orderBy: { createdAt: "asc" },
    select: { url: true },
    take: 20,
  });
  // The services record may be keyed on the booking widget's page; the site
  // is the origin the crawler is pinned to, so a booking product's host is
  // never taken for it.
  for (const candidate of [services, ...others]) {
    if (!candidate?.url) continue;
    try {
      const u = new URL(candidate.url);
      if (!isBookingHost(u.hostname)) return u.origin;
    } catch {
      // A malformed stored url is skipped, not fatal.
    }
  }
  return null;
}

export async function refreshServicesFromSite(
  userId: string,
  log: (m: string) => void = () => {},
  site?: string,
): Promise<RefreshResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "Reading the site needs the model key (ANTHROPIC_API_KEY)." };
  }
  const url = site?.trim() || (await siteUrlFor(userId));
  if (!url) return { ok: false, error: "No website on file to read. Onboard from the site first." };

  const crawler = new Crawler(url, log);
  try {
    const home = await crawler.load(url);
    if (!home) return { ok: false, error: `Could not load ${url}.` };
    const pages = await discoverServicePages(crawler, home, []);
    const { report, extract } = await extractServicesAndBooking(pages, userId, log);
    const enriched = await enrichServices(userId, extract.services, extract.menu, pages, log);
    return { ok: true, services: report.services, ...enriched, site: url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  } finally {
    await crawler.close().catch(() => {});
  }
}
