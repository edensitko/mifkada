import { useEffect, useMemo, useState } from "react";
import { FolderInput, Undo2 } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { refreshSessions } from "../App";
import { projectVisual } from "../lib/groups";
import { cn } from "../lib/util";
import Avatar from "./Avatar";
import type { SessionRow } from "../../../shared/protocol";
import { strings, useT } from "../i18n";

const S = strings({
  he: {
    movedTo: "הסשן מוצג עכשיו תחת {name}",
    restored: "הסשן חזר לתיקייה המקורית שלו",
    title: "העבר לפרויקט",
    search: "חיפוש פרויקט",
    unassign: "בטל שיוך (חזרה ל-{name})",
    notFound: "לא נמצא",
  },
  en: {
    movedTo: "The session now shows under {name}",
    restored: "The session is back in its original folder",
    title: "Move to project",
    search: "Search projects",
    unassign: "Remove assignment (back to {name})",
    notFound: "Nothing found",
  },
});

let dirsCache: string[] | null = null;

/** תפריט "העבר לפרויקט": מציג את הסשן בקבוצה של פרויקט אחר. הסשן עצמו ממשיך לרוץ מהתיקייה המקורית */
export default function MoveToProject({ row, onDone }: { row: SessionRow; onDone: () => void }) {
  const { projectThemes, setToast } = useStore();
  const t = useT(S);
  const [dirs, setDirs] = useState<string[]>(dirsCache ?? []);
  const [q, setQ] = useState("");
  useEffect(() => {
    api
      .projectDirs()
      .then((d) => {
        dirsCache = d;
        setDirs(d);
      })
      .catch(() => undefined);
  }, []);
  const current = row.projectCwd || row.cwd;
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return dirs.filter((d) => d !== current && (!n || d.toLowerCase().includes(n))).slice(0, 40);
  }, [dirs, q, current]);
  const move = async (dir: string | null) => {
    try {
      await api.setProject(row.sessionId, dir);
      refreshSessions();
      setToast(dir ? t("movedTo", { name: dir.split("/").pop() ?? dir }) : t("restored"));
    } catch (e) {
      setToast((e as Error).message);
    }
    onDone();
  };
  return (
    <div className="no-drag absolute top-8 end-2 z-40 card p-1.5 w-64 text-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 px-1.5 pb-1.5 text-muted text-xs">
        <FolderInput className="size-3.5" /> {t("title")}
      </div>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} placeholder={t("search")} className="w-full fill rounded-lg px-2.5 py-1.5 text-sm outline-none mb-1" />
      <div className="max-h-64 overflow-y-auto">
        {row.projectCwd && row.projectCwd !== row.cwd && (
          <button onClick={() => void move(null)} className="w-full text-start px-2.5 py-1.5 rounded-lg hover:bg-surface-2 flex items-center gap-2 text-blue">
            <Undo2 className="size-4" /> {t("unassign", { name: row.cwd.split("/").pop() ?? row.cwd })}
          </button>
        )}
        {shown.map((d) => {
          const v = projectVisual(d, dirs, projectThemes);
          return (
            <button key={d} onClick={() => void move(d)} className={cn("w-full text-start px-2 py-1.5 rounded-lg hover:bg-surface-2 flex items-center gap-2")} title={d}>
              <Avatar emoji={v.emoji} color={v.color} image={v.image} size="sm" square />
              <span className="truncate">{v.name}</span>
              <span className="ms-auto text-[11px] text-muted truncate max-w-24 ltr">{d.split("/").slice(-2, -1)[0]}</span>
            </button>
          );
        })}
        {!shown.length && <div className="text-muted text-xs px-2.5 py-2">{t("notFound")}</div>}
      </div>
    </div>
  );
}
