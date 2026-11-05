import { isRTL, pick } from "../i18n";
import { useStore } from "../store";

export const RAIL = 64;
const MIN = 240;
const MAX = 560;
export const FULL = 360;

/** ידית בקצה סרגל הצד: גרירה משנה רוחב, גרירה עד הסוף מצמצמת לאייקונים, לחיצה כפולה מחליפה בין מצומצם לרגיל */
export default function SidebarResize() {
  const width = useStore((s) => s.sidebarWidth);
  const setWidth = useStore((s) => s.setSidebarWidth);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width < 120 ? RAIL : width;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => {
      // בעברית סרגל הצד מימין (גרירה שמאלה מרחיבה), באנגלית משמאל (גרירה ימינה מרחיבה)
      const w = w0 + (isRTL() ? x0 - ev.clientX : ev.clientX - x0);
      setWidth(w < 170 ? RAIL : Math.min(MAX, Math.max(MIN, w)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      onPointerDown={down}
      onDoubleClick={() => setWidth(width < 120 ? FULL : RAIL)}
      className="no-drag absolute top-0 bottom-0 -end-1 w-2 z-30 cursor-col-resize group/sr"
      title={pick("גרור לשינוי רוחב · לחיצה כפולה מצמצמת או מרחיבה", "Drag to resize · double-click to collapse or expand")}
    >
      <span className="block mx-auto h-full w-0.5 bg-blue opacity-0 group-hover/sr:opacity-50 transition" />
    </div>
  );
}
