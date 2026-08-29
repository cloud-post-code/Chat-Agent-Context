import { currentUser } from "@/lib/auth";
import { exchangeAndStore } from "@/lib/gmail/client";
import { verifyState } from "@/lib/gmail/state";
import { siteOrigin } from "@/lib/util";

export const runtime = "nodejs";

/**
 * Step two: Google sends the admin back here with a one-time code. Verify the
 * state nonce, exchange the code for a refresh token, store it, and return to
 * the Contacts tab with a message.
 *
 * The state check happens BEFORE the exchange — a callback we did not issue
 * never gets to spend a code or write a row.
 *
 * Origins come from siteOrigin(), never req.url, whose host behind Railway's
 * proxy is the server's bind address — and the token exchange's redirect_uri
 * must byte-match the one the connect route sent.
 */
function back(req: Request, message: string): Response {
  return Response.redirect(
    `${siteOrigin(req.headers)}/admin/dashboard?tab=contacts&gmail=${encodeURIComponent(message)}`,
    303,
  );
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return back(req, `Google refused the authorization: ${error}`);

  if (!verifyState(url.searchParams.get("state"))) {
    return back(req, "That sign-in link was not one this site issued, or it expired. Try again.");
  }

  const code = url.searchParams.get("code");
  if (!code) return back(req, "Google returned no authorization code.");

  try {
    const problem = await exchangeAndStore(user.id, code, siteOrigin(req.headers));
    return back(req, problem ?? "Gmail connected.");
  } catch (e) {
    return back(req, e instanceof Error ? e.message : "Token exchange failed.");
  }
}
