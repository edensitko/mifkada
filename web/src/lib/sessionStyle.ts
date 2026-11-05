import type { CSSProperties } from "react";
import type { SessionBackground, SessionMeta } from "../../../shared/protocol";
import { lang } from "../i18n";

/*
 * עיצוב לסשן בודד. הרקעים שקופים למחצה מעל --color-background, כך שהם עובדים גם בבהיר וגם בכהה,
 * ו"גוון" לוקח את צבע הסשן עצמו.
 */
export const BACKGROUNDS: Array<{ id: SessionBackground; he: string; en: string; readonly label: string; css: string }> = [
  { id: "tint", he: "גוון", en: "Tint", get label() { return this[lang()]; }, css: "linear-gradient(color-mix(in srgb, var(--agent-color) 9%, transparent), color-mix(in srgb, var(--agent-color) 9%, transparent)), var(--color-background)" },
  { id: "sunrise", he: "זריחה", en: "Sunrise", get label() { return this[lang()]; }, css: "linear-gradient(160deg, rgba(255,149,0,.20), rgba(255,45,85,.14) 60%, transparent), var(--color-background)" },
  { id: "ocean", he: "ים", en: "Ocean", get label() { return this[lang()]; }, css: "linear-gradient(160deg, rgba(10,132,255,.20), rgba(48,209,200,.14) 60%, transparent), var(--color-background)" },
  { id: "forest", he: "יער", en: "Forest", get label() { return this[lang()]; }, css: "linear-gradient(160deg, rgba(52,199,89,.20), rgba(0,122,90,.12) 60%, transparent), var(--color-background)" },
  { id: "lavender", he: "לבנדר", en: "Lavender", get label() { return this[lang()]; }, css: "linear-gradient(160deg, rgba(175,82,222,.20), rgba(255,100,180,.12) 60%, transparent), var(--color-background)" },
  { id: "graphite", he: "גרפיט", en: "Graphite", get label() { return this[lang()]; }, css: "linear-gradient(180deg, rgba(120,120,128,.22), rgba(120,120,128,.08)), var(--color-background)" },
  { id: "dots", he: "נקודות", en: "Dots", get label() { return this[lang()]; }, css: "radial-gradient(var(--color-separator) 1px, transparent 1.2px) 0 0 / 18px 18px, var(--color-background)" },
];

export const SWATCHES = ["#007aff", "#5856d6", "#af52de", "#ff2d55", "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#30b0c7", "#8e8e93"];

/** מאפייני הקונטיינר של הסשן: ערכת צבעים (data-scheme) ורקע */
export function paneStyle(meta: SessionMeta | undefined): { scheme?: "light" | "dark"; style: CSSProperties } {
  const bg = BACKGROUNDS.find((b) => b.id === meta?.background)?.css;
  return { scheme: meta?.scheme, style: bg ? { background: bg } : meta?.scheme ? { background: "var(--color-background)" } : {} };
}
