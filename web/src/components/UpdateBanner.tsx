import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useStore } from "../store";
import { strings, useT } from "../i18n";

const S = strings({
  he: { newVersion: "יש גרסה חדשה של מפקדה", reload: "רענן", later: "אחר כך" },
  en: { newVersion: "A new version of Mifkada is available", reload: "Reload", later: "Later" },
});

declare global {
  interface Window {
    __mifkadaUpdate?: (kind: "web" | "server") => void;
  }
}

/** האם בטוח לטעון את החלון עכשיו: בלי טיוטה בתיבת כתיבה, בלי שיחה קולית, ובלי חלון בפוקוס שמשתמשים בו */
function safeToReload(): boolean {
  if (useStore.getState().voiceMode) return false;
  const typing = [...document.querySelectorAll("textarea")].some((t) => (t as HTMLTextAreaElement).value.trim());
  if (typing) return false;
  return document.hidden || !document.hasFocus();
}

/** גרסה חדשה של הממשק (עדכון חם): נטען לבד כשבטוח, ואחרת פס קטן עם "רענן" */
export default function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const t = useT(S);
  useEffect(() => {
    let pending = false;
    window.__mifkadaUpdate = (kind) => {
      // שרת שעלה מחדש: ה-WebSocket מתחבר לבד, אין צורך לטעון את הממשק
      if (kind === "server") return;
      if (safeToReload()) location.reload();
      else {
        pending = true;
        setReady(true);
        setDismissed(false);
      }
    };
    // מחכה עדכון: נטען לבד ברגע שהחלון יוצא מפוקוס ואין טיוטה
    const onBlur = () => setTimeout(() => pending && safeToReload() && location.reload(), 500);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      delete window.__mifkadaUpdate;
    };
  }, []);
  if (!ready || dismissed) return null;
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] ios-toast flex items-center gap-3 ps-4 pe-2 py-1.5 text-[13.5px]">
      <span>{t("newVersion")}</span>
      <button onClick={() => location.reload()} className="btn-primary rounded-full px-3 py-1 text-[13px] flex items-center gap-1.5">
        <RefreshCw className="size-3.5" /> {t("reload")}
      </button>
      <button onClick={() => setDismissed(true)} className="text-muted hover:text-foreground p-1" title={t("later")}>
        <X className="size-4" />
      </button>
    </div>
  );
}
