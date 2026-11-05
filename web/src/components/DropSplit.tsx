import { useEffect, useState } from "react";
import { Columns2, Maximize2, Plus, Replace, ArrowLeftRight } from "lucide-react";
import { useStore, type ChatSel } from "../store";
import { cn } from "../lib/util";
import { gridDims, SESSION_DRAG } from "../lib/split";
import { strings, useT } from "../i18n";

const S = strings({
  he: { session: "סשן", here: "פתח כאן", beside: "פתח לצד", put: "שים כאן", add: "הוסף חלון", onScreen: "{n} על המסך" },
  en: { session: "Session", here: "Open here", beside: "Open beside", put: "Put here", add: "Add pane", onScreen: "{n} on screen" },
});

export { SESSION_DRAG };

type Payload = ChatSel & { from?: number };
type Target = { kind: "cell"; i: number } | { kind: "add" } | { kind: "here" } | { kind: "beside" };
const keyOf = (t: Target | null) => (t ? (t.kind === "cell" ? `cell${t.i}` : t.kind) : "");

/**
 * גרירה אל אזור הצ'אט. בלי מסך מחולק: "פתח כאן" או "פתח לצד".
 * עם מסך מחולק: אותה רשת כמו על המסך, וכל משבצת היא יעד (החלפה, או החלפת מקומות כשגוררים כותרת של חלון),
 * ובצד משבצת "הוסף חלון" עד 6.
 */
export default function DropSplit() {
  const [dragging, setDragging] = useState(false);
  const t = useT(S);
  const [target, setTarget] = useState<Target | null>(null);
  const { selection, split, layout, colSizes, rowSizes, lives, sessions } = useStore();
  const hasChat = selection?.kind === "live" || selection?.kind === "history";
  const panes: ChatSel[] = hasChat ? [selection as ChatSel, ...split] : [];
  const n = panes.length;

  useEffect(() => {
    const isOurs = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes(SESSION_DRAG));
    const enter = (e: DragEvent) => isOurs(e) && setDragging(true);
    const end = () => {
      setDragging(false);
      setTarget(null);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);

  if (!dragging) return null;

  const titleOf = (c: ChatSel) => (c.kind === "live" ? (lives.find((l) => l.liveId === c.liveId)?.title ?? t("session")) : (sessions.find((s) => s.sessionId === c.sessionId)?.title ?? t("session")));

  const drop = (tg: Target) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    setTarget(null);
    let p: Payload;
    try {
      p = JSON.parse(e.dataTransfer.getData(SESSION_DRAG)) as Payload;
    } catch {
      return;
    }
    const { from, ...c } = p;
    const st = useStore.getState();
    if (tg.kind === "cell") {
      if (from !== undefined) st.swapPanes(from, tg.i);
      else st.replacePane(tg.i, c as ChatSel);
    } else if (tg.kind === "add" || tg.kind === "beside") {
      if (from === undefined) st.openBeside(c as ChatSel);
    } else st.select(c as ChatSel);
  };
  const over = (tg: Target) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (keyOf(target) !== keyOf(tg)) setTarget(tg);
  };
  // JSX ישיר ולא קומפוננטה פנימית: אחרת האלמנט נבנה מחדש בכל dragover והשחרור הולך לאיבוד
  const zone = (tg: Target, label: string, Icon: typeof Plus, sub?: string) => {
    const on = keyOf(target) === keyOf(tg);
    return (
      <div key={keyOf(tg)} onDragOver={over(tg)} onDrop={drop(tg)} className="flex-1 min-w-0 min-h-0 p-1.5 flex">
        <div className={cn("flex-1 rounded-[18px] border-2 border-dashed grid place-items-center transition-all p-3", on ? "border-blue bg-blue/15" : "border-blue/30 bg-blue/5")}>
          <div className={cn("flex flex-col items-center gap-1.5 text-center font-medium min-w-0", on ? "text-blue" : "text-blue/70")}>
            <Icon className="size-7" />
            <span>{label}</span>
            {sub && <span className="text-[12px] font-normal text-muted truncate max-w-56">{sub}</span>}
          </div>
        </div>
      </div>
    );
  };

  if (n <= 1) {
    return (
      <div className="absolute inset-0 z-40 flex bg-background/60 backdrop-blur-[3px] p-2">
        {hasChat ? (
          <>
            <div className="flex-1 flex">{zone({ kind: "here" }, t("here"), Maximize2)}</div>
            <div className="flex-1 flex">{zone({ kind: "beside" }, t("beside"), Columns2)}</div>
          </>
        ) : (
          <div className="flex-1 flex">{zone({ kind: "here" }, t("here"), Maximize2)}</div>
        )}
      </div>
    );
  }

  const { cols, rows } = gridDims(n, layout);
  const fr = (saved: number[], k: number) => (saved.length === k ? saved : Array(k).fill(1)).map((f) => `minmax(0, ${f}fr)`).join(" ");
  return (
    <div className="absolute inset-0 top-9 z-40 flex bg-background/60 backdrop-blur-[3px] p-1.5 gap-1.5">
      <div className="flex-1 grid" style={{ gridTemplateColumns: fr(colSizes, cols), gridTemplateRows: fr(rowSizes, rows) }}>
        {panes.map((p, i) => zone({ kind: "cell", i }, t("put"), target?.kind === "cell" && target.i === i ? ArrowLeftRight : Replace, titleOf(p)))}
      </div>
      {n < 6 && <div className="w-44 flex">{zone({ kind: "add" }, t("add"), Plus, t("onScreen", { n: n + 1 }))}</div>}
    </div>
  );
}
