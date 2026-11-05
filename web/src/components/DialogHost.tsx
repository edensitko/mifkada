import { useEffect, useRef, useState } from "react";
import { answer, useDialog } from "../lib/dialog";
import { strings, useT } from "../i18n";

const S = strings({
  he: { ok: "אישור", cancel: "ביטול" },
  en: { ok: "OK", cancel: "Cancel" },
});

/** חלון אישור / הזנה בתוך הממשק (lib/dialog.ts). Enter מאשר, Esc מבטל */
export default function DialogHost() {
  const req = useDialog((s) => s.current);
  const t = useT(S);
  const [text, setText] = useState("");
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!req) return;
    setText(req.initial ?? "");
    // פוקוס: לשדה בהזנה, לכפתור האישור באישור רגיל (ובפעולה מסוכנת לביטול, כדי ש-Enter לא ימחק בטעות)
    requestAnimationFrame(() => {
      if (req.kind === "prompt") inputRef.current?.select();
      else if (!req.danger) okRef.current?.focus();
    });
  }, [req]);

  if (!req) return null;
  const cancel = () => answer(req.kind === "prompt" ? null : false);
  const ok = () => answer(req.kind === "prompt" ? text : true);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/30 backdrop-blur-[2px] p-6"
      onMouseDown={(e) => e.target === e.currentTarget && cancel()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <div role="dialog" aria-modal="true" className="card w-full max-w-[440px] p-5 flex flex-col gap-4 animate-[fade-up_0.18s_ease-out]">
        <p dir="auto" className="text-[14px] leading-relaxed whitespace-pre-line">
          {req.message}
        </p>
        {req.kind === "prompt" && (
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ok()}
            className="rounded-lg bg-surface-2 px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-blue/40"
          />
        )}
        <div className="flex justify-end gap-2">
          <button onClick={cancel} className="rounded-lg px-4 py-1.5 text-[14px] hover:bg-surface-2">
            {t("cancel")}
          </button>
          <button
            ref={okRef}
            onClick={ok}
            className={req.danger ? "rounded-lg px-4 py-1.5 text-[14px] font-medium bg-danger text-white" : "btn-primary rounded-lg px-4 py-1.5 text-[14px] font-medium"}
          >
            {t("ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
