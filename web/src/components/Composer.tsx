import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Mic, Square, AudioLines, Paperclip, X, FileText } from "lucide-react";
import type { Attachment } from "../../../shared/protocol";
import { api, type CommandInfo } from "../api";
import SlashMenu from "./SlashMenu";
import { useStore } from "../store";
import { Recorder } from "../lib/speech";
import { getPrefs } from "../lib/prefs";
import { strings, useT } from "../i18n";
import { Spinner } from "./Spinner";

const S = strings({
  he: {
    noMic: "אין גישה למיקרופון: {err}",
    dropToAttach: "שחרר כדי לצרף",
    remove: "הסר",
    uploading: "מעלה",
    commands: "פקודות ו-skills (או הקלד /)",
    attach: "צרף קובץ (או גרור לחלון, או הדבק צילום מסך)",
    endCall: "סיים שיחה",
    voiceChat: "שיחה קולית רציפה",
    listening: "מאזין",
    transcribing: "מתמלל",
    thinking: "חושב",
    speaking: "מדבר",
    call: "שיחה",
    stopRec: "עצור והמר לטקסט",
    speak: "דבר",
    send: "שליחה (Enter)",
    recording: "מקליט... לחץ שוב לסיום",
    emptyFile: "הקובץ {name} הגיע ריק (0 בייטים) ולא צורף. אם הוא ב-iCloud, פתח אותו פעם אחת ב-Finder ונסה שוב",
    unreadable: "אי אפשר לקרוא את {name}: {err}",
  },
  en: {
    noMic: "No microphone access: {err}",
    dropToAttach: "Drop to attach",
    remove: "Remove",
    uploading: "Uploading",
    commands: "Commands and skills (or type /)",
    attach: "Attach a file (or drag it into the window, or paste a screenshot)",
    endCall: "End call",
    voiceChat: "Continuous voice chat",
    listening: "Listening",
    transcribing: "Transcribing",
    thinking: "Thinking",
    speaking: "Speaking",
    call: "Voice",
    stopRec: "Stop and convert to text",
    speak: "Dictate",
    send: "Send (Enter)",
    recording: "Recording... click again to finish",
    emptyFile: "{name} arrived empty (0 bytes) and wasn't attached. If it's in iCloud, open it once in Finder and try again",
    unreadable: "Can't read {name}: {err}",
  },
});

/** שדה הודעה כמו iMessage: גלולה, כפתור שליחה עגול כחול. */
export default function Composer({
  disabled,
  placeholder,
  onSend,
  voice,
  cwd,
  onCommand,
  current,
  controls,
  draftKey,
}: {
  disabled?: boolean;
  placeholder: string;
  onSend: (text: string, attachments?: Attachment[]) => void;
  voice?: { active: boolean; phase: string; toggle: () => void };
  /** תיקיית הסשן: ממנה נטענות פקודות ה-/ (skills, פקודות פרויקט) */
  cwd?: string;
  /** פקודת / שמפקדה מטפלת בה בעצמה. מחזיר true אם טופלה ולא צריך לשלוח */
  onCommand?: (name: string, args: string) => boolean;
  /** הערכים הנוכחיים (model, mode) לסימון בתפריט ה-/ */
  current?: Record<string, string | null | undefined>;
  /** בקרות שמוצגות מתחת לשדה (אייג'נט, מודל, מצב) */
  controls?: React.ReactNode;
  /** טיוטה שנשמרת בין מעברים וטעינות מחדש (לפי סשן) */
  draftKey?: string;
}) {
  const DRAFT = draftKey ? `mifkada.draft.${draftKey}` : null;
  const [text, setText] = useState(() => {
    try {
      return (DRAFT && localStorage.getItem(DRAFT)) || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (!DRAFT) return;
    const id = setTimeout(() => {
      try {
        if (text) localStorage.setItem(DRAFT, text);
        else localStorage.removeItem(DRAFT);
      } catch {
        /* אין אחסון */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [text, DRAFT]);
  const slashKey = useRef<((e: React.KeyboardEvent) => boolean) | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const slashQuery = /^\/(\S*)$/.exec(text)?.[1];
  const slashOpen = slashQuery !== undefined && Boolean(cwd) && dismissed !== text && !disabled;
  // "/model " או "/model op": תפריט שני עם הערכים של הפקודה (אם יש לה רשימה סגורה)
  const argMatch = /^\/(\S+) (\S*)$/.exec(text);
  const slashArg = argMatch && cwd && dismissed !== text && !disabled ? { name: argMatch[1], q: argMatch[2] } : null;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [sttOk, setSttOk] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef<Recorder | null>(null);
  const setToast = useStore((s) => s.setToast);
  const tx = useT(S);
  const voiceAutoSend = useStore((s) => s.voiceAutoSend);
  useEffect(() => {
    api
      .sttAvailable()
      .then((r) => setSttOk(r.available))
      .catch(() => setSttOk(false));
  }, []);

  const toggleRecording = async () => {
    if (recording) {
      setRecording(false);
      setTranscribing(true);
      try {
        const blob = await recRef.current!.stop();
        const t = await api.stt(blob);
        if (t) {
          const next = (text ? text + " " : "") + t;
          if (voiceAutoSend && !disabled) {
            onSend(next.trim());
            setText("");
          } else setText(next);
        }
      } catch (e) {
        setToast((e as Error).message);
      } finally {
        setTranscribing(false);
      }
      return;
    }
    try {
      recRef.current = new Recorder();
      await recRef.current.start();
      setRecording(true);
    } catch (e) {
      setToast(tx("noMic", { err: (e as Error).message }));
    }
  };

  // קבצים מצורפים: מהדק, גרירה לחלון, או הדבקה (⌘V) של צילום מסך
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const addFiles = async (list: FileList | File[]) => {
    // הבייטים נקראים מיד, לפני כל await: FileList של input/גרירה מתרוקן אחרי האירוע, ו-Blob מקובץ לא עובר את mifkada:// ב-Tauri
    const items = Array.from(list).map((f) => ({ f, bytes: f.arrayBuffer() }));
    for (const { f, bytes } of items) {
      setUploading((n) => n + 1);
      try {
        let buf: ArrayBuffer;
        try {
          buf = await bytes;
        } catch (e) {
          throw new Error(tx("unreadable", { name: f.name, err: (e as Error).message }));
        }
        if (buf.byteLength === 0) throw new Error(tx("emptyFile", { name: f.name || "paste.png" }));
        const a = await api.upload(f.name, f.type, buf);
        setFiles((cur) => [...cur, a]);
      } catch (e) {
        setToast((e as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  useEffect(() => {
    // גרירה לכל אזור הצ'אט, לא רק לשדה. במסך מחולק רק החלון שמתחת לעכבר מקבל את הקובץ
    const mine = (e: Event) => {
      const pane = rootRef.current?.closest("[data-chat-pane]");
      return !pane || (e.target instanceof Node && pane.contains(e.target));
    };
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragOver(mine(e));
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      if (!mine(e)) {
        setDragOver(false);
        e.preventDefault();
        return;
      }
      e.preventDefault();
      setDragOver(false);
      void addFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // הטיוטה נמחקת מיד בשליחה (לא אחרי ההשהיה): שליחה מסשן היסטורי פותחת סשן חי, הצ'אט נבנה מחדש,
  // ותיבת הכתיבה החדשה הייתה טוענת את הטיוטה הישנה ומציגה שוב את מה שכבר נשלח
  const clearDraft = () => {
    try {
      if (DRAFT) localStorage.removeItem(DRAFT);
    } catch {
      /* אין אחסון */
    }
  };
  const submit = (override?: string) => {
    const t = (override ?? text).trim();
    if ((!t && files.length === 0) || disabled || uploading > 0) return;
    clearDraft();
    const cmd = /^\/([\w:.-]+)\s*([\s\S]*)$/.exec(t);
    if (cmd && onCommand?.(cmd[1], cmd[2].trim())) {
      setText("");
      if (ref.current) ref.current.style.height = "auto";
      return;
    }
    onSend(t, files);
    setFiles([]);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  };

  const pickCommand = (c: CommandInfo, run: boolean) => {
    if (run) {
      submit(`/${c.name}`);
      return;
    }
    setText(`/${c.name} `);
    ref.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((slashOpen || slashArg) && slashKey.current?.(e)) return;
    // Enter שולח (ברירת מחדל), או ⌘Enter בלבד לפי ההגדרות
    const enterSends = getPrefs().enterToSend;
    if (e.key === "Enter" && !e.nativeEvent.isComposing && (enterSends ? !e.shiftKey : e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div ref={rootRef} className="pane-clear px-5 pb-4 pt-2 bg-background relative">
      <SlashMenu
        withLocal={Boolean(onCommand)}
        cwd={cwd}
        query={slashQuery ?? ""}
        arg={slashArg}
        current={current}
        active={slashOpen || Boolean(slashArg)}
        onPick={pickCommand}
        onPickArg={(name, value) => submit(`/${name} ${value}`)}
        onClose={() => setDismissed(text)}
        keyRef={slashKey}
      />
      {dragOver && <div className="absolute inset-x-5 -top-24 bottom-4 z-20 rounded-[22px] border-2 border-dashed border-blue bg-blue/8 grid place-items-center text-blue font-medium pointer-events-none">{tx("dropToAttach")}</div>}
      {(files.length > 0 || uploading > 0) && (
        <div className="flex flex-wrap gap-2 mb-2">
          {files.map((f) => (
            <span key={f.path} className="group flex items-center gap-2 rounded-xl bg-surface border border-border ps-1 pe-2 py-1 text-xs max-w-60">
              {f.mime.startsWith("image/") ? <img src={`/api/uploads/file?path=${encodeURIComponent(f.path)}`} alt="" className="size-8 rounded-lg object-cover" /> : <FileText className="size-4 text-muted ms-1" />}
              <span className="truncate">{f.name}</span>
              <button onClick={() => setFiles((cur) => cur.filter((x) => x.path !== f.path))} className="text-muted hover:text-danger" title={tx("remove")}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          {uploading > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Spinner className="size-3.5" /> {tx("uploading")}
            </span>
          )}
        </div>
      )}
      <div className="composer-box flex items-end gap-2 rounded-[22px] bg-surface border border-border px-4 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,.04)] focus-within:border-blue/60 transition">
        <textarea
          ref={ref}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 220) + "px";
          }}
          onKeyDown={onKey}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.files);
            if (imgs.length) {
              e.preventDefault();
              void addFiles(imgs);
            }
          }}
          rows={1}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent outline-none text-[15px] leading-relaxed py-1.5 placeholder:text-muted disabled:opacity-50"
        />
        {cwd && (
          <button
            onClick={() => {
              setDismissed(null);
              setText((t) => (t.startsWith("/") ? t : "/"));
              ref.current?.focus();
            }}
            disabled={disabled}
            className="size-8 mb-0.5 rounded-full grid place-items-center text-muted hover:text-foreground hover:bg-surface-2 transition disabled:opacity-40 mono text-[15px] font-semibold"
            title={tx("commands")}
          >
            /
          </button>
        )}
        <button onClick={() => fileInput.current?.click()} disabled={disabled} className="size-8 mb-0.5 rounded-full grid place-items-center text-muted hover:text-foreground hover:bg-surface-2 transition disabled:opacity-40" title={tx("attach")}>
          <Paperclip className="size-4" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {sttOk && voice && (
          <button onClick={voice.toggle} className={"h-8 mb-0.5 rounded-full px-2.5 flex items-center gap-1.5 text-xs transition " + (voice.active ? "bg-blue text-white" : "bg-surface-2 text-muted hover:text-foreground")} title={voice.active ? tx("endCall") : tx("voiceChat")}>
            <AudioLines className={"size-4 " + (voice.active && voice.phase === "listening" ? "pulse" : "")} />
            {voice.active ? voice.phase === "listening" ? tx("listening") : voice.phase === "transcribing" ? tx("transcribing") : voice.phase === "thinking" ? tx("thinking") : voice.phase === "speaking" ? tx("speaking") : tx("call") : tx("call")}
          </button>
        )}
        {sttOk && !voice?.active && (
          <button onClick={toggleRecording} disabled={transcribing} className={"size-8 mb-0.5 rounded-full grid place-items-center transition " + (recording ? "bg-danger text-white pulse" : "bg-surface-2 text-muted hover:text-foreground")} title={recording ? tx("stopRec") : tx("speak")}>
            {transcribing ? <Spinner className="size-4" /> : recording ? <Square className="size-3.5" /> : <Mic className="size-4" />}
          </button>
        )}
        <button onClick={() => submit()} disabled={disabled || uploading > 0 || (!text.trim() && files.length === 0)} className="size-8 mb-0.5 rounded-full bg-blue text-white grid place-items-center disabled:opacity-30" title={tx("send")}>
          <ArrowUp className="size-4" strokeWidth={2.5} />
        </button>
      </div>
      {/* אייג'נט, מודל ומצב (מהצ'אט); בזמן הקלטה במקומם הסבר. הקיצורים בדף הקיצורים (⌘/) */}
      {(controls || recording) && <div className="flex items-center gap-1.5 mt-2 px-1 text-[11.5px] text-muted min-w-0 overflow-x-auto">{recording ? <span className="px-1">{tx("recording")}</span> : controls}</div>}
    </div>
  );
}
