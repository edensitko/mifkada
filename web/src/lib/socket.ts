/**
 * חיבור WebSocket לשרת של מפקדה. באפליקציה (Electron) אין לשרת פורט ברשת בכלל: הוא מאזין על קובץ שקע מקומי,
 * והתהליך הראשי של Electron מעביר את ההודעות דרך גשר (preload). בדפדפן רגיל ובפיתוח: WebSocket רגיל.
 * הממשק כאן זהה ל-WebSocket במה שאנחנו משתמשים בו: onopen, onmessage, onclose, send, close, readyState, binaryType.
 */
type NetBridge = {
  open: (id: string, path: string) => void;
  send: (id: string, data: string) => void;
  close: (id: string) => void;
  onEvent: (cb: (e: { id: string; type: "open" | "message" | "close"; data?: string | ArrayBuffer }) => void) => void;
};

declare global {
  interface Window {
    mifkadaNet?: NetBridge;
  }
}

const listeners = new Map<string, BridgeSocket>();
let wired = false;

class BridgeSocket {
  static readonly OPEN = 1;
  readyState = 0;
  binaryType: "arraybuffer" | "blob" = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly id = crypto.randomUUID();
  private readonly net: NetBridge;
  constructor(net: NetBridge, path: string) {
    this.net = net;
    if (!wired) {
      wired = true;
      net.onEvent((e) => {
        const s = listeners.get(e.id);
        if (!s) return;
        if (e.type === "open") {
          s.readyState = 1;
          s.onopen?.();
        } else if (e.type === "message") s.onmessage?.({ data: e.data ?? "" });
        else {
          s.readyState = 3;
          listeners.delete(e.id);
          s.onclose?.();
        }
      });
    }
    listeners.set(this.id, this);
    net.open(this.id, path);
  }
  send(data: string): void {
    if (this.readyState === 1) this.net.send(this.id, data);
  }
  close(): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.net.close(this.id);
  }
}

export function openSocket(path: "/ws" | "/ws/term"): WebSocket {
  if (window.mifkadaNet) return new BridgeSocket(window.mifkadaNet, path) as unknown as WebSocket;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}${path}`);
}

/** מצב "פתוח", גם לגשר וגם ל-WebSocket רגיל */
export const SOCKET_OPEN = 1;
