import { useEffect, useRef } from "react";
import { isDark } from "../lib/prefs";
import * as monaco from "monaco-editor";

/** diff צד-לצד של Monaco: לפני (HEAD) ואחרי (עץ העבודה). */
export default function DiffEditor({ path, before, after }: { path: string; before: string; after: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const dark = isDark();
    const ed = monaco.editor.createDiffEditor(ref.current, {
      theme: dark ? "vs-dark" : "vs",
      readOnly: true,
      renderSideBySide: true,
      automaticLayout: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      ignoreTrimWhitespace: false,
    });
    const ext = path.split(".").pop() ?? "";
    const lang = monaco.languages.getLanguages().find((l) => l.extensions?.includes("." + ext))?.id;
    const original = monaco.editor.createModel(before, lang);
    const modified = monaco.editor.createModel(after, lang);
    ed.setModel({ original, modified });
    return () => {
      ed.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [path, before, after]);
  return <div ref={ref} dir="ltr" className="h-full w-full" />;
}
