import { MODEL_OPTIONS, MODE_OPTIONS } from "./util";
import { strings, tr, type Strings } from "../i18n";

export interface ArgOption {
  value: string;
  label: string;
  hint?: string;
}

/** תוויות לערכים נפוצים של פקודות CLI, בשתי השפות */
const LEVELS = strings({
  he: { low: "נמוך - מהיר", medium: "בינוני", high: "גבוה", xhigh: "גבוה מאוד", max: "מקסימום", auto: "אוטומטי", ultra: "ultra - בענן", ultracode: "ultracode" },
  en: { low: "Low - fast", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum", auto: "Automatic", ultra: "ultra - in the cloud", ultracode: "ultracode" },
});
const FAST = strings({ he: { on: "הפעל", off: "כבה" }, en: { on: "Turn on", off: "Turn off" } });
const ADVISOR = strings({ he: { off: "כבוי" }, en: { off: "Off" } });
const OPT_LABELS: Record<string, Strings<string>> = {
  effort: LEVELS,
  "code-review": LEVELS,
  fast: FAST,
  advisor: ADVISOR,
};

/**
 * האפשרויות לפקודה שמקבלת ערך מתוך רשימה סגורה. model ו-mode מהרשימות של הממשק (בלי "מאשר הכול": זה רק מהסרגל,
 * עם אישור). לשאר: הקבוצה הראשונה ב-argumentHint של ה-CLI, למשל "[low|medium|high]" או "consent | revoke".
 * null = אין רשימה סגורה (טקסט חופשי), ואז לא נפתח תפריט שני.
 */
export function commandOptions(name: string, hint: string | undefined): ArgOption[] | null {
  if (name === "model") return MODEL_OPTIONS.filter((o) => o.value).map((o) => ({ value: o.value!, label: o.label }));
  if (name === "mode") return MODE_OPTIONS.filter((o) => o.value !== "bypassPermissions").map((o) => ({ value: o.value, label: o.label, hint: o.hint }));
  if (!hint) return null;
  const group = /^\s*[[<]([^[\]>]*(?:\[[^\]]*\][^[\]>]*)*)[\]>]/.exec(hint)?.[1] ?? (/[[<]/.test(hint) ? null : hint);
  if (!group || !group.includes("|")) return null;
  const words = group
    .replace(/\[[^\]]*\]/g, "")
    .split("|")
    .map((w) => w.trim());
  if (!words.every((w) => /^[\w.-]+$/.test(w))) return null;
  const labels = OPT_LABELS[name];
  return [...new Set(words)].map((w) => ({ value: w, label: labels && Object.hasOwn(labels.he, w) ? tr(labels, w) : w }));
}
