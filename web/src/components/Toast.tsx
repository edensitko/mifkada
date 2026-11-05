import { useEffect } from "react";
import { useStore } from "../store";

/** הודעה צפה בתחתית המסך, בסגנון iOS: קפסולה מטושטשת שנעלמת לבד. לחיצה סוגרת. */
export default function Toast() {
  const toast = useStore((s) => s.toast);
  const setToast = useStore((s) => s.setToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast, setToast]);
  if (!toast) return null;
  return (
    <div className="fixed bottom-6 inset-x-0 z-[60] flex justify-center pointer-events-none">
      <button onClick={() => setToast(null)} dir="auto" className="ios-toast pointer-events-auto px-5 py-2.5 text-[14px] font-medium max-w-[min(560px,90vw)] text-center animate-[fade-up_0.25s_ease-out]">
        {toast}
      </button>
    </div>
  );
}
