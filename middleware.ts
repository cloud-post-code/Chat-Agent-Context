import { NextResponse, type NextRequest } from "next/server";

/**
 * Markdown content negotiation. An LLM (or the tool fetching for it) that asks
 * for a page as `text/markdown` gets the Markdown document instead of a chat
 * box that renders nothing without JavaScript; `/a/<slug>.md` is the same
 * request for clients that can't set headers. Browsers send `text/html` or
 * a wildcard accept and are never touched.
 */

const AGENT_PAGE = /^\/a\/([^/.]+)(\.md)?$/;

export function middleware(req: NextRequest): NextResponse | undefined {
  const { pathname } = req.nextUrl;
  const accept = req.headers.get("accept") ?? "";
  const wantsMarkdown = accept.includes("text/markdown") && !accept.includes("text/html");

  const page = pathname.match(AGENT_PAGE);
  if (page && (page[2] || wantsMarkdown)) {
    return NextResponse.rewrite(new URL(`/a/${page[1]}/llms-full.txt`, req.url));
  }
  if (pathname === "/" && wantsMarkdown) {
    return NextResponse.rewrite(new URL("/llms.txt", req.url));
  }
  return undefined;
}

export const config = { matcher: ["/", "/a/:slug"] };
