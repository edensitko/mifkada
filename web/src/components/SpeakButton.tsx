import { useEffect, useState } from "react";
import { Volume2, Square } from "lucide-react";
import { onSpeakingChange, speak, stopSpeaking } from "../lib/speech";
import { useStore } from "../store";
import { cn } from "../lib/util";
import { strings, useT } from "../i18n";

const S = strings({
  he: { stopReading: "עצור הקראה", read: "הקרא", stop: "עצור" },
  en: { stopReading: "Stop reading", read: "Read aloud", stop: "Stop" },
});

/** כפתור "הקרא": מקריא את הטקסט, ולחיצה נוספת עוצרת. */
export default function SpeakButton({ text, className, label }: { text: string | (() => string); className?: string; label?: string }) {
  const [mine, setMine] = useState(false);
  const setToast = useStore((s) => s.setToast);
  const t = useT(S);
  useEffect(() => onSpeakingChange((on) => !on && setMine(false)), []);
  const toggle = async () => {
    if (mine) {
      stopSpeaking();
      setMine(false);
      return;
    }
    setMine(true);
    try {
      await speak(typeof text === "function" ? text() : text);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setMine(false);
    }
  };
  return (
    <button onClick={toggle} className={cn("inline-flex items-center gap-1 rounded-lg transition", mine ? "text-blue" : "text-muted hover:text-foreground", className)} title={mine ? t("stopReading") : t("read")}>
      {mine ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-4" />}
      {label && <span className="text-xs">{mine ? t("stop") : label}</span>}
    </button>
  );
}
