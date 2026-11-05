import { useState } from "react";
import { cn } from "../lib/util";
import { pick } from "../i18n";

/** גודל שנשמר בין הפעלות (localStorage), עם גבולות. null = ברירת המחדל של הפריסה */
export function useStoredSize(key: string, min: number, max: number): [number | null, (v: number | null) => void] {
  const [v, setV] = useState<number | null>(() => {
    const n = Number(localStorage.getItem(key));
    return n ? Math.min(max, Math.max(min, n)) : null;
  });
  const set = (n: number | null) => {
    const c = n === null ? null : Math.round(Math.min(max, Math.max(min, n)));
    setV(c);
    try {
      if (c === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(c));
    } catch {
      /* אין אחסון */
    }
  };
  return [v, set];
}

/**
 * ידית גרירה בין שני חלונות. onDrag מקבל את התזוזה בפיקסלים מתחילת הגרירה (dx או dy, לפי הציר),
 * והקורא מחליט לאיזה כיוון זה מגדיל. לחיצה כפולה = onReset (חזרה לברירת המחדל).
 */
export default function ResizeHandle({ axis, onStart, onDrag, onReset, className, title = pick("גרור לשינוי גודל · לחיצה כפולה מאפסת", "Drag to resize · Double-click to reset") }: { axis: "x" | "y"; onStart: () => void; onDrag: (delta: number) => void; onReset?: () => void; className?: string; title?: string }) {
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    onStart();
    const x0 = e.clientX;
    const y0 = e.clientY;
    document.body.style.userSelect = "none";
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    // iframe (תצוגה מקדימה) ו-Monaco בולעים אירועי עכבר באמצע גרירה: שכבה שקופה מעל הכול עד השחרור
    const shield = document.createElement("div");
    shield.style.cssText = `position:fixed;inset:0;z-index:9999;cursor:${axis === "x" ? "col-resize" : "row-resize"}`;
    document.body.appendChild(shield);
    const move = (ev: PointerEvent) => onDrag(axis === "x" ? ev.clientX - x0 : ev.clientY - y0);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      shield.remove();
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      onPointerDown={down}
      onDoubleClick={onReset}
      title={title}
      className={cn("no-drag shrink-0 relative z-20 group/rh", axis === "x" ? "w-0 cursor-col-resize" : "h-0 cursor-row-resize", className)}
    >
      {/* אזור תפיסה רחב יותר מהקו עצמו */}
      <span className={cn("absolute", axis === "x" ? "inset-y-0 -inset-x-1" : "inset-x-0 -inset-y-1")} />
      <span className={cn("absolute bg-blue opacity-0 group-hover/rh:opacity-60 transition", axis === "x" ? "inset-y-0 -start-px w-0.5" : "inset-x-0 -top-px h-0.5")} />
    </div>
  );
}
