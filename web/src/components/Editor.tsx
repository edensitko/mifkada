import { useEffect, useRef } from "react";
import { isDark } from "../lib/prefs";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import cssWorker from "monaco-editor/language/css/css.worker.js?worker";
import htmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

const models = new Map<string, monaco.editor.ITextModel>();

/** עורך Monaco (העורך של VS Code). Cmd+S שומר דרך onSave. */
export default function Editor({ fileKey, content, onChange, onSave, line }: { fileKey: string; content: string; onChange: (v: string) => void; onSave: () => void; line?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    if (!ref.current) return;
    const dark = isDark();
    const editor = monaco.editor.create(ref.current, {
      theme: dark ? "vs-dark" : "vs",
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 13,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      padding: { top: 8 },
      renderLineHighlight: "line",
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let model = models.get(fileKey);
    if (!model) {
      model = monaco.editor.createModel(content, undefined, monaco.Uri.file(fileKey));
      models.set(fileKey, model);
    } else if (model.getValue() !== content) {
      model.setValue(content);
    }
    editor.setModel(model);
    const sub = model.onDidChangeContent(() => onChange(model!.getValue()));
    return () => sub.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !line) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  }, [line, fileKey]);

  return <div ref={ref} dir="ltr" className="h-full w-full" />;
}
