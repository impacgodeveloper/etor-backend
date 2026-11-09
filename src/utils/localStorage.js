import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.resolve(__dirname, "../../uploads");

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

const tenantDir = (tenantSchema, subdir) => {
  if (!SAFE_SEGMENT.test(tenantSchema || "") || !SAFE_SEGMENT.test(subdir || "")) {
    throw new Error("Invalid upload location");
  }
  return path.join(UPLOADS_ROOT, tenantSchema, subdir);
};

// Files live under uploads/<tenant>/<subdir>/ with a random name, so a URL
// can't be guessed and one organization's files never share a folder with
// another's. BASE_URL (e.g. https://api.example.com) is prepended to the URL.
export async function saveFile(buffer, tenantSchema, subdir, originalName) {
  const dir = tenantDir(tenantSchema, subdir);
  const ext = path.extname(originalName || "").toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
  const filename = `${crypto.randomUUID()}${ext}`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
  const base = (process.env.BASE_URL || "").replace(/\/$/, "");
  return `${base}/uploads/${tenantSchema}/${subdir}/${filename}`;
}

// Deletes a stored file, but only if it resolves inside the caller's own
// tenant folder — a stored URL is never trusted to point anywhere else.
export async function deleteLocalFile(fileUrl, tenantSchema) {
  if (!fileUrl || !SAFE_SEGMENT.test(tenantSchema || "")) return;
  let urlPath = fileUrl;
  try {
    urlPath = new URL(fileUrl).pathname;
  } catch {
    // Already a relative path
  }
  const uploadsIndex = urlPath.indexOf("/uploads/");
  if (uploadsIndex === -1) return;
  const relPath = decodeURIComponent(urlPath.slice(uploadsIndex + "/uploads/".length));
  const filePath = path.resolve(UPLOADS_ROOT, relPath);
  const allowedRoot = path.join(UPLOADS_ROOT, tenantSchema) + path.sep;
  if (!filePath.startsWith(allowedRoot)) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // File not found — ignore
  }
}
