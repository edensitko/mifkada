import { useEffect, useRef } from "react";
import { openSocket, SOCKET_OPEN } from "../lib/socket";
import { isDark } from "../lib/prefs";
import { pick } from "../i18n";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const LIGHT = { background: "#ffffff", foreground: "#1c1c1e", cursor: "#007aff", selectionBackground: "#007aff33", black: "#1c1c1e", brightBlack: "#8a8a8e" };
const DARK = { background: "#1c1c1e", foreground: "#f5f5f7", cursor: "#0a84ff", selectionBackground: "#0a84ff44" };

/** טרמינל אמיתי בתיקיית הפרויקט, דרך /ws/term. */
export default function Terminal({ cwd }: { cwd: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dark = isDark();
    const term = new XTerm({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
      theme: dark ? DARK : LIGHT,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    fit.fit();

    const ws = openSocket("/ws/term");
    ws.binaryType = "arraybuffer";
    const sendJson = (m: unknown) => ws.readyState === SOCKET_OPEN && ws.send(JSON.stringify(m));
    ws.onopen = () => sendJson({ t: "open", cwd, cols: term.cols, rows: term.rows });
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const m = JSON.parse(ev.data) as { t: string; code?: number; message?: string };
          if (m.t === "exit") term.write(`\r\n\x1b[90m[${pick("הטרמינל נסגר", "Terminal closed")}]\x1b[0m\r\n`);
          if (m.t === "error") term.write(`\r\n\x1b[31m${m.message}\x1b[0m\r\n`);
        } catch {
          term.write(ev.data);
        }
        return;
      }
      term.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => term.write(`\r\n\x1b[90m[${pick("החיבור לטרמינל נסגר", "Terminal connection closed")}]\x1b[0m\r\n`);
    const dataSub = term.onData((d) => sendJson({ t: "input", data: d }));

    const ro = new ResizeObserver(() => {
      fit.fit();
      sendJson({ t: "resize", cols: term.cols, rows: term.rows });
    });
    ro.observe(el);
    const t = setTimeout(() => term.focus(), 100);

    return () => {
      clearTimeout(t);
      ro.disconnect();
      dataSub.dispose();
      ws.close();
      term.dispose();
    };
  }, [cwd]);

  return <div ref={ref} dir="ltr" className="h-full w-full ltr px-2 py-1 bg-surface" />;
}
