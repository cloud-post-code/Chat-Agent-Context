/**
 * The caller's address, as best a proxy will tell us. Shared because more than
 * one endpoint rate-limits by it, and two copies of proxy-header parsing is two
 * places to fix when the deployment's header set changes.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/** Parse JSON safely, returning a fallback on any error. */
export function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * The site's public origin. Prefers the configured URL; falls back to the
 * proxy headers so a preview deploy advertises itself correctly instead of
 * handing other agents — or Google's OAuth redirect — a localhost URL that
 * doesn't answer.
 */
export function siteOrigin(headers?: Headers): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = headers?.get("x-forwarded-host") ?? headers?.get("host");
  if (!host) return "http://localhost:3000";
  const proto = headers?.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
