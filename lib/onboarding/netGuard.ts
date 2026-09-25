import dns from "node:dns";

/**
 * Where onboarding's browser may go: public hosts on the public internet.
 * A tenant types a site address and a browser then clicks through whatever
 * answers there for a minute, so an address that names something inside the
 * network — a loopback service, a metadata endpoint, a `.internal` name — must
 * be refused before the browser ever opens it.
 *
 * Two layers, because names lie:
 *  - `isPublicHostname` is syntactic and synchronous: the literal address or
 *    name as written, for hot paths (every request the browser makes).
 *  - `isPublicTarget` also resolves the name and holds every address it
 *    resolves to (a `nip.io`-style name resolves to whatever it encodes) to the
 *    same rule. Resolution failures refuse; results are cached briefly.
 */

/** Names that never leave a network, matched on the last label(s). */
const PRIVATE_SUFFIX = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|svc|cluster\.local|arpa)$/;

/** Name → is-public, with an expiry; DNS is asked once a minute per host. */
const cache = new Map<string, { ok: boolean; until: number }>();
const CACHE_MS = 60_000;
const LOOKUP_MS = 5_000;

/** Dotted-decimal IPv4 → its four octets, or null. Only the canonical form is
 *  accepted: the WHATWG URL parser already turns `0x7f.1` and `2130706433`
 *  into dotted decimal, and anything else that looks numeric is refused. */
function parseIpv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** An IPv6 literal (without brackets) → its eight 16-bit groups, or null.
 *  An embedded dotted IPv4 tail (`::ffff:10.0.0.1`) is folded into the last
 *  two groups, as the address itself has it. */
function parseIpv6(s: string): number[] | null {
  let str = s;
  const zone = str.indexOf("%");
  if (zone >= 0) str = str.slice(0, zone);
  if (!/^[0-9a-fA-F:.]+$/.test(str) || str.split("::").length > 2) return null;
  // A dotted IPv4 tail becomes two hex groups.
  const lastColon = str.lastIndexOf(":");
  const tail = str.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    str = `${str.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const [head, rest] = str.split("::");
  const groupsOf = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const a = groupsOf(head);
  const b = rest === undefined ? [] : groupsOf(rest);
  if (!a || !b) return null;
  if (rest === undefined) return a.length === 8 ? a : null;
  if (a.length + b.length > 7) return null;
  return [...a, ...Array<number>(8 - a.length - b.length).fill(0), ...b];
}

/** Whether four octets are a public unicast IPv4 address. */
function ipv4IsPublic(o: number[]): boolean {
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return false; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private 172.16/12
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && (o[2] === 0 || o[2] === 2)) return false; // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && o[2] === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && o[2] === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Whether eight groups are a public unicast IPv6 address. */
function ipv6IsPublic(g: number[]): boolean {
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::ffff:a.b.c.d (IPv4-mapped) and 64:ff9b::/96 (NAT64) carry an IPv4 address.
  if (zeroTo(5) && g[5] === 0xffff) return ipv4IsPublic([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return ipv4IsPublic([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  }
  if (zeroTo(7) && (g[7] === 0 || g[7] === 1)) return false; // :: and ::1
  if (zeroTo(6)) return false; // ::a.b.c.d IPv4-compatible (deprecated)
  const top = g[0] >> 8;
  if ((top & 0xfe) === 0xfc) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if (top === 0xff) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo tunnels an IPv4 we can't vet
  if (g[0] === 0x2002) return ipv4IsPublic([g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff]); // 6to4
  return true;
}

/** Whether an IP address (v4 dotted, or v6 with or without brackets) is public. Non-addresses are false. */
export function isPublicIp(address: string): boolean {
  let s = address.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const v4 = parseIpv4(s);
  if (v4) return ipv4IsPublic(v4);
  const v6 = parseIpv6(s);
  return v6 ? ipv6IsPublic(v6) : false;
}

/**
 * Syntactic: whether a hostname, as written, names a public host. IP literals
 * must be public addresses; names must be dotted, not end in a suffix that
 * stays inside a network, and not be an unparsed numeric form. Says nothing
 * about what the name resolves to — that is `isPublicTarget`.
 */
export function isPublicHostname(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (host.startsWith("[") || host.includes(":")) return isPublicIp(host);
  while (host.endsWith(".")) host = host.slice(0, -1);
  if (!host) return false;
  // Numeric forms the URL parser didn't canonicalize (`0x7f.1`, `2130706433`,
  // `127.1`) are addresses in disguise: canonicalize through it, then judge.
  if (/^[\d.]+$/.test(host) || /(^|\.)0x/.test(host)) {
    let canon: string;
    try {
      canon = new URL(`http://${host}/`).hostname;
    } catch {
      return false;
    }
    return isPublicIp(canon);
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return false;
  if (host.split(".").some((l) => l.startsWith("-") || l.endsWith("-") || l.length > 63)) return false;
  if (PRIVATE_SUFFIX.test(host)) return false;
  return true;
}

/** The hostname of a url, or "" when it has none, the scheme isn't http(s), or it carries credentials. */
function webHost(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (u.username || u.password) return "";
    return u.hostname;
  } catch {
    return "";
  }
}

async function resolvesPublic(host: string): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(host);
  if (hit && hit.until > now) return hit.ok;
  let ok = false;
  try {
    const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("lookup timeout")), LOOKUP_MS).unref());
    const found = await Promise.race([dns.promises.lookup(host, { all: true }), timer]);
    ok = found.length > 0 && found.every((a) => isPublicIp(a.address));
  } catch {
    ok = false;
  }
  cache.set(host, { ok, until: Date.now() + CACHE_MS });
  if (cache.size > 5000) cache.clear();
  return ok;
}

/**
 * Whether a url is one the browser may open: http(s) to a syntactically public
 * host whose EVERY resolved address is public. A name that doesn't resolve is
 * not public (a browser couldn't reach it either). Results are cached ~60 s.
 */
export async function isPublicTarget(url: string): Promise<boolean> {
  const host = webHost(url);
  if (!host || !isPublicHostname(host)) return false;
  if (isPublicIp(host)) return true;
  return resolvesPublic(host);
}

/** Test hook: forget resolved answers. */
export function resetPublicTargetCache(): void {
  cache.clear();
}
