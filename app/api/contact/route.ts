import { tenantBySlug } from "@/lib/tenant";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Records a contact submission from the in-chat contact form card. `slug`
 * names whose agent page the form was on, so the submission lands in that
 * owner's Contacts tab.
 */
export async function POST(req: Request) {
  let body: { name?: string; email?: string; message?: string; slug?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim();
  const user = await tenantBySlug(slug);
  if (!user) {
    return Response.json({ ok: false, error: "No such agent." }, { status: 404 });
  }

  const name = String(body.name ?? "").trim().slice(0, 200);
  const email = String(body.email ?? "").trim().slice(0, 200);
  const message = String(body.message ?? "").trim().slice(0, 5000);

  if (!name || !email || !message) {
    return Response.json({ ok: false, error: "All fields are required." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ ok: false, error: "That email doesn't look right." }, { status: 400 });
  }

  try {
    await prisma.contact.create({ data: { userId: user.id, name, email, message } });
  } catch {
    return Response.json({ ok: false, error: "Could not save. Try again." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
