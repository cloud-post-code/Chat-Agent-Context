import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Image uploads are written to UPLOAD_DIR (a Railway volume in prod, ./data
 * locally). We never put them in /public so the same code works in both.
 * They're served back through app/api/uploads/[name]/route.ts.
 */

export function uploadDir(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), "data", "uploads");
}

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};

export async function saveUpload(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  return saveBytes(bytes, file.type);
}

/** Save already-read bytes with a known content type. Returns the filename. */
export async function saveBytes(bytes: Buffer, contentType: string): Promise<string> {
  if (!ALLOWED.has(contentType)) {
    throw new Error(`Unsupported file type: ${contentType}`);
  }
  const dir = uploadDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const filename = `${randomUUID()}${EXT[contentType]}`;
  await writeFile(path.join(dir, filename), bytes);
  return filename;
}

/** Read a stored upload for serving. Guards against path traversal. */
export async function readUpload(
  filename: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  // Only allow a bare filename — no slashes or dot segments.
  if (!/^[a-f0-9-]+\.(jpg|png|webp|gif|pdf)$/i.test(filename)) return null;
  const full = path.join(uploadDir(), filename);
  if (!existsSync(full)) return null;
  const bytes = await readFile(full);
  const ext = path.extname(filename).toLowerCase();
  const contentType =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : ext === ".pdf"
            ? "application/pdf"
            : "image/jpeg";
  return { bytes, contentType };
}
