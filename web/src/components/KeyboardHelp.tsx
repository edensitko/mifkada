import { useEffect } from "react";
import { X } from "lucide-react";
import { useStore } from "../store";
import { pick } from "../i18n";

/** הקבוצות נבנות בכל פתיחה, כדי שהתוויות יהיו בשפה הנוכחית */
const groups = (): Array<{ title: string; keys: Array<[string, string]> }> => [
  {
    title: pick("כללי", "General"),
    keys: [
      ["⌘K", pick("חיפוש בכול: סשנים, פרויקטים, משימות ופעולות", "Search everything: sessions, projects, tasks and actions")],
      ["⌘N", pick("סשן חדש", "New session")],
      ["⌘B", pick("הסתרת רשימת הסשנים", "Hide the session list")],
      ["⌘,", pick("הגדרות", "Settings")],
      ["⌘1-6", pick("ממתין לך, קנבן, אייג'נטים, מאגרים, הרחבות, מפה", "Waiting for you, Board, Agents, Repositories, Extensions, Map")],
      ["⌥⌘Space", pick("שיחה קולית מכל מקום במחשב", "Voice chat from anywhere on your computer")],
      ["⌘/", pick("הדף הזה", "This page")],
    ],
  },
  {
    title: pick("בצ'אט", "In chat"),
    keys: [
      ["Enter", pick("שליחה (Shift+Enter לשורה חדשה)", "Send (Shift+Enter for a new line)")],
      ["/", pick("פקודות ו-skills", "Commands and skills")],
      ["⌘F", pick("חיפוש בתוך השיחה", "Search in the conversation")],
      ["⌘W", pick("סגירת הכרטיסייה של השיחה (סגנון IDE). סגירת החלון: ⇧⌘W", "Close the chat tab (IDE style). Close the window: ⇧⌘W")],
      ["⌃Tab", pick("הכרטיסייה הבאה (⌃⇧Tab: הקודמת)", "Next tab (⌃⇧Tab: previous)")],
      ["⌥ + X", pick("סגירת סשן עם סיכום, משימות וארכיון (X לבד סוגר מיד)", "Close a session with a summary, tasks and archive (X alone closes right away)")],
      ["⌘V", pick("הדבקת צילום מסך כקובץ מצורף", "Paste a screenshot as an attachment")],
      ["click", pick("לחיצה על סשן: פתיחה במקום החלונית הראשית", "Click a session: open it in place of the main pane")],
      ["⌘ + click", pick("⌘-לחיצה על סשן: פתיחה בחלונית נוספת ליד", "⌘-click a session: open it in another pane beside")],
      [pick("גרירה", "drag"), pick("גרירת סשן מסרגל הצד לאמצע: עד 6 צ'אטים על המסך", "Drag a session from the sidebar to the middle: up to 6 chats on screen")],
    ],
  },
  {
    title: pick("קוד", "Code"),
    keys: [
      ["⌘E", pick("פתיחה וסגירה של הקוד ליד הצ'אט", "Show or hide the code beside the chat")],
      ["⌘P", pick("פתיחה מהירה של קובץ", "Quick open a file")],
      ["⌘⇧F", pick("חיפוש בפרויקט", "Search in the project")],
      ["⌘J", pick("טרמינל", "Terminal")],
      ["⌘S", pick("שמירת קובץ", "Save file")],
    ],
  },
];

/** ⌘/ : כל קיצורי המקלדת, בגיליון אחד */
export default function KeyboardHelp() {
  const open = useStore((s) => s.help);
  const setHelp = useStore((s) => s.setHelp);
  // Esc סוגר (היה נסגר רק בלחיצה מחוץ לחלון, ונשאר חוסם את כל המסך)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHelp(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setHelp]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] grid place-items-center" onMouseDown={() => setHelp(false)}>
      <div className="card w-[min(560px,92vw)] max-h-[80vh] overflow-y-auto p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-4">
          <h2 className="text-[20px] font-bold tracking-tight">{pick("קיצורי מקלדת", "Keyboard shortcuts")}</h2>
          <button onClick={() => setHelp(false)} className="ms-auto size-8 rounded-full grid place-items-center fill text-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-5">
          {groups().map((g) => (
            <div key={g.title}>
              <div className="group-header !px-1">{g.title}</div>
              <div className="group-list fill !bg-[var(--color-surface-2)]/50">
                {g.keys.map(([k, d]) => (
                  <div key={k} className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
                    <span className="flex-1">{d}</span>
                    <kbd className="mono text-[12px] rounded-md bg-surface px-2 py-0.5 ltr shadow-[0_1px_0_var(--color-separator)]">{k}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
