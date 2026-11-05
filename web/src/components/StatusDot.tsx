import { cn } from "../lib/util";
import { pick } from "../i18n";
import type { LiveState } from "../../../shared/protocol";

export function liveStateLabel(state: LiveState | "history"): string {
  switch (state) {
    case "ready":
      return pick("מוכן", "Ready");
    case "starting":
      return pick("מתחיל", "Starting");
    case "running":
      return pick("עובד", "Working");
    case "waiting":
      return pick("ממתין לאישור", "Waiting for approval");
    case "idle":
      return pick("ממתין לך", "Waiting for you");
    case "closed":
      return pick("נסגר", "Closed");
    case "error":
      return pick("שגיאה", "Error");
    default:
      return pick("היסטוריה", "History");
  }
}

/** נורת סטטוס. חי: טורקיז, ממתין לאישור: ענבר, שגיאה: אדום, היסטוריה: אפור בלי זוהר. */
export default function StatusDot({ state, external, className }: { state?: LiveState | null; external?: string | null; className?: string }) {
  let color = "text-border";
  let pulse = false;
  let lamp = false;
  if (state) {
    lamp = true;
    if (state === "running" || state === "starting") (color = "text-teal"), (pulse = true);
    else if (state === "waiting") (color = "text-amber"), (pulse = true);
    else if (state === "idle" || state === "ready") color = "text-teal";
    else if (state === "error") color = "text-danger";
    else (color = "text-muted"), (lamp = false);
  } else if (external) {
    lamp = true;
    color = "text-teal";
    pulse = external !== "idle";
  }
  return <span className={cn(lamp ? "lamp" : "inline-block size-2 rounded-full bg-border shrink-0", color, pulse && "pulse", className)} />;
}
