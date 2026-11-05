import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "./paths.js";
import type { Attachment } from "../../shared/protocol.js";
import { L } from "./i18n.js";

export const UPLOADS = path.join(DATA_DIR, "uploads");
const MAX = 50 * 1024 * 1024;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
};

/** שומר קובץ שצורף בצ'אט תחת data/uploads/<תאריך>/, ומחזיר את הנתיב ש-Claude יכול לקרוא. */
export async function saveUpload(name: string, body: Buffer, mimeHint?: string): Promise<Attachment> {
  if (body.length === 0) throw new Error(L("קובץ ריק", "Empty file"));
  if (body.length > MAX) throw new Error(L("הקובץ גדול מ-50MB", "The file is larger than 50MB"));
  const safe = (path.basename(name || "file").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "file").trim();
  const dir = path.join(UPLOADS, new Date().toISOString().slice(0, 10));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID().slice(0, 8)}-${safe}`);
  await fs.writeFile(file, body);
  const ext = safe.split(".").pop()?.toLowerCase() ?? "";
  return { path: file, name: safe, mime: mimeHint && mimeHint !== "application/octet-stream" ? mimeHint : (MIME[ext] ?? "application/octet-stream"), size: body.length };
}

/** קריאה של קובץ שהועלה, רק מתוך תיקיית ההעלאות. */
export async function readUpload(p: string): Promise<Buffer> {
  const abs = path.resolve(p);
  if (!abs.startsWith(path.resolve(UPLOADS) + path.sep)) throw new Error(L("מחוץ לתיקיית ההעלאות", "Outside the uploads folder"));
  return fs.readFile(abs);
}
