import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * אייקון טעינה מסתובב. הסיבוב על span ולא על ה-svg: אנימציה על svg לא עוברת ל-GPU,
 * ו-Chromium מחשב סגנון ומצייר אותה בכל פריים (120 בשנייה במסך ProMotion). נמדד: כ-15% CPU לספינר אחד.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span className="spin-box">
      <Loader2 className={className} />
    </span>
  );
}

/** עוטף אייקון קיים שמסתובב רק כשצריך (רענון, סנכרון) */
export function Spin({ on, children }: { on: boolean; children: ReactNode }) {
  return <span className={on ? "spin-box" : "inline-flex shrink-0"}>{children}</span>;
}
