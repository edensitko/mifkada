import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serverLang } from "./i18n.js";
import { voiceTools, whichCommand } from "./platform.js";

const MODEL = process.env.WHISPER_MODEL ?? path.join(os.homedir(), "whisper-models", "ggml-large-v3-turbo-q5_0.bin");
const WHISPER = process.env.WHISPER_CLI ?? voiceTools().whisper;
const FFMPEG = process.env.FFMPEG ?? voiceTools().ffmpeg;

/** קיים: נתיב מלא = הקובץ קיים, שם בלבד = נמצא ב-PATH */
async function exists(bin: string): Promise<void> {
  if (bin.includes("/") || bin.includes("\\")) return fs.access(bin);
  await new Promise<void>((res, rej) => execFile(whichCommand(), [bin], { timeout: 3000 }, (err) => (err ? rej(err) : res())));
}

function run(bin: string, args: string[], timeout = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(`${path.basename(bin)}: ${String(stderr).slice(-300) || err.message}`)) : resolve(String(stdout))));
  });
}

export async function sttAvailable(): Promise<boolean> {
  try {
    await Promise.all([fs.access(MODEL), exists(WHISPER), exists(FFMPEG)]);
    return true;
  } catch {
    return false;
  }
}

/** תמלול מקומי: webm/opus מהדפדפן → wav 16k → whisper.cpp בשפת הממשק (he / en), אלא אם התבקשה שפה אחרת. */
export async function transcribe(audio: Buffer, requested?: string): Promise<string> {
  // רק קוד שפה קצר (או auto) עובר ל-whisper כארגומנט
  const lang = requested && /^([a-z]{2}|auto)$/.test(requested) ? requested : serverLang();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mifkada-stt-"));
  const input = path.join(dir, "in.webm");
  const wav = path.join(dir, "in.wav");
  try {
    await fs.writeFile(input, audio);
    await run(FFMPEG, ["-y", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-f", "wav", wav], 30000);
    const out = await run(WHISPER, ["-m", MODEL, "-l", lang, "-f", wav, "-nt", "-np", "-t", "6"]);
    const text = out.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
    return isHallucination(text, lang) ? "" : text;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * whisper "שומע" משפטים קבועים על שקט ורעש רקע (מנתוני האימון שלו, כתוביות של סרטונים).
 * כשמשפט כזה מגיע לבד, זה לא דיבור אמיתי.
 */
const HALLUCINATIONS = [
  "תודה רבה",
  "תודה",
  "תודה רבה לכם",
  "תודה שצפיתם",
  "תודה על הצפייה",
  "כתוביות",
  "תרגום",
  "שלום",
  "ביי",
  "אמן",
  "thank you",
  "thank you very much",
  "thank you so much",
  "thanks",
  "thanks for watching",
  "thank you for watching",
  "thanks for watching and see you next time",
  "please subscribe",
  "subscribe to my channel",
  "like and subscribe",
  "see you next time",
  "see you in the next video",
  "the end",
  "you",
  "bye",
  "bye bye",
  "goodbye",
];
/**
 * lang = השפה שבה whisper רץ. הכללים של העברית ושל האנגלית פעילים תמיד (whisper בעברית ממציא גם "Thank you.").
 * רק בדיקת האותיות המוטעמות תלויה בשפה: באנגלית מילה כמו café היא דיבור אמיתי, ולכן שם נדרשות כמה כאלה.
 */
export function isHallucination(text: string, lang = "he"): boolean {
  const t = text
    .toLowerCase()
    .replace(/[.,!?…"'״׳\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;
  if (/^(כתוביות|תרגום|subtitles|captions|transcribed by|transcription by)/.test(t)) return true;
  // בלי אף אות עברית אבל עם אותיות לטיניות מוטעמות (þ, ö, é): whisper "שמע" רעש בשפה זרה, לא דיבור שלך
  // באנגלית מילה כמו café היא דיבור אמיתי, ולכן שם נדרשות כמה אותיות כאלה
  const accented = (t.match(/[\u00C0-\u024F]/g) ?? []).length;
  if (!/[\u0590-\u05FF]/.test(t) && accented >= (lang === "en" ? 3 : 1)) return true;
  return HALLUCINATIONS.includes(t) || /^(תודה רבה ?){2,}$/.test(t) || /^(thank you ?){2,}$/.test(t);
}
