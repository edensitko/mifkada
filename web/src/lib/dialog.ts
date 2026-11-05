import { create } from "zustand";

/**
 * חלונות אישור והזנה בתוך הממשק, במקום confirm/prompt/alert של הדפדפן.
 * ב-WebKit של Tauri (macOS) אין להם מימוש: confirm מחזיר false מיד בלי להציג כלום, ולכן כל פעולה עם "בטוח?" נכשלה בשקט.
 * מוצג על ידי DialogHost (components/DialogHost.tsx).
 */
export type DialogRequest = {
  kind: "confirm" | "prompt";
  message: string;
  initial?: string;
  danger?: boolean;
  resolve: (value: string | boolean | null) => void;
};

export const useDialog = create<{ current: DialogRequest | null; queue: DialogRequest[] }>(() => ({ current: null, queue: [] }));

function open(req: DialogRequest): void {
  const s = useDialog.getState();
  if (s.current) useDialog.setState({ queue: [...s.queue, req] });
  else useDialog.setState({ current: req });
}

/** סגירת החלון הנוכחי עם התשובה, ומעבר לבא בתור */
export function answer(value: string | boolean | null): void {
  const { current, queue } = useDialog.getState();
  if (!current) return;
  current.resolve(value);
  useDialog.setState({ current: queue[0] ?? null, queue: queue.slice(1) });
}

/** "בטוח?" → true / false */
export function ask(message: string, opts: { danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => open({ kind: "confirm", message, danger: opts.danger, resolve: (v) => resolve(v === true) }));
}

/** שדה טקסט אחד → הטקסט, או null בביטול */
export function askText(message: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => open({ kind: "prompt", message, initial, resolve: (v) => resolve(typeof v === "string" ? v : null) }));
}
