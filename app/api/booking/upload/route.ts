import { prisma } from "@/lib/db";
import { getBookingConfig } from "@/lib/appointments";
import { saveUpload } from "@/lib/uploads";

export const runtime = "nodejs";

/** Matches lib/uploads.ts's ALLOWED set and DESIGN.md's stated ceiling. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * An intake upload (a photo, a file, a drawn signature exported as PNG) for
 * the booking flow — file/photo/signature question types and, later, an
 * uploaded lead image never reach here since those go through the admin's
 * own upload path. Gated on booking being on for this tenant so the upload
 * volume can't be used as an anonymous file host.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  const slug = String(form.get("slug") ?? "").trim();
  const user = slug ? await prisma.user.findUnique({ where: { slug } }) : null;
  if (!user) {
    return Response.json({ ok: false, error: "No such agent." }, { status: 404 });
  }

  const { enabled } = await getBookingConfig(user.id);
  if (!enabled) {
    return Response.json({ ok: false, error: "Booking isn't available right now." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "No file was sent." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, error: "That file is too large (8 MB max)." }, { status: 400 });
  }

  try {
    const filename = await saveUpload(file);
    return Response.json({ ok: true, path: `/api/uploads/${filename}` });
  } catch {
    return Response.json({ ok: false, error: "That file type isn't supported." }, { status: 400 });
  }
}
