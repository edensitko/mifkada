import { useEffect, useState, type MutableRefObject, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { strings, useT } from "../../i18n";

const S = strings({
  he: { placeholder: "חיפוש בשיחה", none: "אין", close: "סגור" },
  en: { placeholder: "Search this chat", none: "None", close: "Close" },
});

/** ⌘F בתוך שיחה: מחפש בבועות ובשורות הכלים, קופץ בין תוצאות מהאחרונה אחורה */
export function useChatFind(scrollRef: RefObject<HTMLDivElement | null>, stickRef: MutableRefObject<boolean>, pane?: number) {
  const [find, setFind] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);

  // רק בחלון הראשי, כדי ש-⌘F לא ייפתח בכל החלונות במסך המחולק
  useEffect(() => {
    if (pane !== undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && !e.shiftKey) {
        e.preventDefault();
        setFind((f) => (f === null ? "" : f));
        setTimeout(() => document.getElementById("chat-find")?.focus(), 30);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pane]);

  const run = (q: string, step: number, from = idx) => {
    const root = scrollRef.current;
    root?.querySelectorAll(".find-hit").forEach((el) => el.classList.remove("find-hit"));
    if (!root || !q.trim()) {
      setCount(0);
      return;
    }
    const needle = q.trim().toLowerCase();
    const hits = [...root.querySelectorAll<HTMLElement>(".bubble-user, .bubble-assistant, .tool-group")].filter((el) => (el.textContent ?? "").toLowerCase().includes(needle));
    setCount(hits.length);
    if (!hits.length) return;
    const i = (((from + step) % hits.length) + hits.length) % hits.length;
    setIdx(i);
    const el = hits[hits.length - 1 - i];
    el.classList.add("find-hit");
    stickRef.current = false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const close = () => {
    run("", 0);
    setFind(null);
  };
  const change = (q: string) => {
    setFind(q);
    setIdx(0);
    run(q, 0, 0);
  };
  return { find, idx, count, run, close, change };
}

export function ChatFindBar({ f }: { f: ReturnType<typeof useChatFind> }) {
  const t = useT(S);
  if (f.find === null) return null;
  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 ios-toast !rounded-2xl flex items-center gap-2 px-3 py-1.5">
      <Search className="size-4 text-muted" />
      <input
        id="chat-find"
        value={f.find}
        onChange={(e) => f.change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") f.run(f.find ?? "", e.shiftKey ? -1 : 1);
          if (e.key === "Escape") f.close();
        }}
        placeholder={t("placeholder")}
        className="bg-transparent outline-none w-56 text-sm"
      />
      <span className="text-xs text-muted tabular w-12 text-center">{f.find.trim() ? (f.count ? `${f.idx + 1}/${f.count}` : t("none")) : ""}</span>
      <button onClick={f.close} className="text-muted hover:text-foreground" title={t("close")} aria-label={t("close")}>
        <X className="size-4" />
      </button>
    </div>
  );
}
