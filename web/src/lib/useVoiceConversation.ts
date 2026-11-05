import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore, type Transcript } from "../store";
import { getPrefs } from "./prefs";
import { enqueueSpeech, isSpeechBusy, playAck, monitorBargeIn, onOutputLevel, onSpeakingChange, recordUntilSilence, stopSpeaking, whenSpeechIdle } from "./speech";
import { strings, tr } from "../i18n";

/*
 * VOICE_TAG: הנחיה שמצורפת להודעה בשיחה קולית, ומוסתרת בתצוגה (VOICE_TAG_RE ב-Blocks, שמכיר את שתי השפות).
 * שתי הגרסאות חייבות להתחיל ב-"(" + הכותרת + ":" ולא להכיל ")" באמצע, אחרת Blocks לא יסתיר אותן.
 * stopWords: מילים שמסיימות את השיחה בכל מקרה, בנוסף למה שבהגדרות.
 */
const S = strings({
  he: {
    tag: "(מצב שיחה קולית: לענות קצר וטבעי, כמו בשיחה, בעברית מדוברת. בלי טבלאות, קוד, נתיבים או רשימות ארוכות אלא אם ביקשתי. אם צריך פירוט, לסכם במשפט ולהציע להראות על המסך)\n",
    stopWords: "סיים שיחה, עצור, תפסיק, ביי",
    noMic: "אין גישה למיקרופון: {err}",
    permission: "יש בקשת אישור על המסך",
  },
  en: {
    tag: "(Voice chat mode: answer briefly and naturally, like in a conversation, in spoken English. No tables, code, paths or long lists unless I ask. If detail is needed, sum it up in a sentence and offer to show it on screen)\n",
    stopWords: "end call, stop, bye, goodbye",
    noMic: "No microphone access: {err}",
    permission: "There's a permission request on screen",
  },
});

/** ההנחיה בשפת הממשק הנוכחית */
export const voiceTag = (): string => tr(S, "tag");

/** משפט שמסיים את השיחה, לפי המילים שבהגדרות ומילות ברירת המחדל של השפה */
function isStopPhrase(text: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[.,!?״"']/g, "").replace(/\s+/g, " ").trim();
  const t = norm(text);
  return `${getPrefs().voiceStopWords},${tr(S, "stopWords")}`
    .split(",")
    .map(norm)
    .filter(Boolean)
    .some((w) => t === w);
}

export type VoicePhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

/**
 * שיחה קולית רציפה: מאזין → מתמלל → שולח → Claude עונה (כל הודעה מוקראת דרך התור ב-ws.ts) →
 * כשהתור של Claude נגמר וההקראה הסתיימה → מאזין שוב.
 */
export function useVoiceConversation(transcript: Transcript | undefined, send: (text: string) => Promise<void> | void, interruptClaude?: () => void) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
  const [speakingNow, setSpeakingNow] = useState(false);
  const [outLevel, setOutLevel] = useState(0);
  const listeningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const mutedRef = useRef(false);
  const setVoiceMode = useStore((s) => s.setVoiceMode);
  const setToast = useStore((s) => s.setToast);

  useEffect(() => onSpeakingChange(setSpeakingNow), []);
  useEffect(() => {
    let last = 0;
    return onOutputLevel((l) => {
      const now = performance.now();
      if (now - last > 40 || l === 0) {
        last = now;
        setOutLevel(l);
      }
    });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    stopSpeaking();
    setActive(false);
    setPhase("idle");
    setLevel(0);
    setVoiceMode(false);
  }, [setVoiceMode]);

  const listen = useCallback(async () => {
    const ctrl = abortRef.current;
    if (!ctrl || ctrl.signal.aborted || mutedRef.current || listeningRef.current) return;
    listeningRef.current = true;
    try {
    // שהייה קצרה אחרי ההקראה, כדי שהמיקרופון לא יקלוט את סוף הקול מהרמקולים
    await new Promise((r) => setTimeout(r, 600));
    if (ctrl.signal.aborted || mutedRef.current) return;
    setPhase("listening");
    let blob: Blob | null = null;
    let last = 0;
    try {
      blob = await recordUntilSilence({
        signal: ctrl.signal,
        silenceMs: getPrefs().voiceSilenceMs,
        onLevel: (rms) => {
          const now = performance.now();
          if (now - last > 50) {
            last = now;
            setLevel(Math.min(1, rms * 9));
          }
        },
      });
    } catch (e) {
      setToast(tr(S, "noMic", { err: (e as Error).message }));
      return stop();
    }
    setLevel(0);
    if (ctrl.signal.aborted || mutedRef.current) return;
    if (!blob) {
      listeningRef.current = false;
      return void listen(); // שקט: ממשיכים להאזין
    }
    setPhase("transcribing");
    try {
      const text = (await api.stt(blob)).trim();
      if (ctrl.signal.aborted) return;
      if (!text || text.length < 2) {
        listeningRef.current = false;
        return void listen();
      }
      if (isStopPhrase(text)) return stop();
      setHeard(text);
      playAck();
      setPhase("thinking");
      await send(voiceTag() + text);
    } catch (e) {
      setToast((e as Error).message);
      listeningRef.current = false;
      void listen();
    }
    } finally {
      listeningRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send]);

  const start = useCallback(() => {
    abortRef.current = new AbortController();
    mutedRef.current = false;
    setMuted(false);
    setHeard("");
    setActive(true);
    setVoiceMode(true);
    void listen();
  }, [listen, setVoiceMode]);

  const toggle = useCallback(() => (active ? stop() : start()), [active, start, stop]);

  /** ממשיכים שיחה שהתחילה לפני שהסשן נפתח מחדש: Claude כבר עונה, אז מחכים לתשובה ולא מקשיבים */
  const resume = useCallback(
    (prevHeard: string) => {
      abortRef.current = new AbortController();
      mutedRef.current = false;
      setMuted(false);
      setHeard(prevHeard);
      setActive(true);
      setVoiceMode(true);
      setPhase("thinking");
    },
    [setVoiceMode],
  );

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      // עוצרים את ההקלטה הנוכחית אבל נשארים בשיחה
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setLevel(0);
      setPhase("idle");
    } else if (!isSpeechBusy()) void listen();
  }, [listen]);

  // כשהתור של Claude נגמר: לחכות שההקראה תסתיים ואז להאזין שוב
  useEffect(() => {
    if (!active || phase !== "thinking" || !transcript) return;
    if (transcript.state !== "idle" && transcript.state !== "closed" && transcript.state !== "error") return;
    setPhase("speaking");
    let cancelled = false;
    // רגע קצר כדי שההודעה האחרונה תספיק להיכנס לתור
    setTimeout(() => {
      void whenSpeechIdle().then(() => {
        if (!cancelled && abortRef.current && !abortRef.current.signal.aborted) void listen();
      });
    }, 300);
    return () => {
      cancelled = true;
    };
  }, [active, phase, transcript, listen]);

  // קטיעה בדיבור, כמו ב-ChatGPT: בזמן שהוא מדבר, אם מתחילים לדבר, הוא שותק, עוצר את Claude ומקשיב
  useEffect(() => {
    if (!active || muted || !speakingNow || !getPrefs().voiceBargeIn) return;
    const ctrl = new AbortController();
    void monitorBargeIn(ctrl.signal, () => {
      stopSpeaking();
      interruptClaude?.();
      setPhase("idle");
      void listen();
    });
    return () => ctrl.abort();
  }, [active, muted, speakingNow, listen, interruptClaude]);

  /** לחיצה על הכדור בזמן שהוא מדבר: קוטעים ומקשיבים */
  const interrupt = useCallback(() => {
    if (!active) return;
    stopSpeaking();
    interruptClaude?.();
    void listen();
  }, [active, listen, interruptClaude]);

  // בקשת אישור באמצע: להגיד את זה
  useEffect(() => {
    if (active && phase === "thinking" && transcript?.pending.length) enqueueSpeech(tr(S, "permission"));
  }, [active, phase, transcript?.pending.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // התשובה האחרונה של Claude, לכתובית מתחת לכדור
  const reply = (() => {
    if (!transcript) return "";
    const last = [...transcript.messages].reverse().find((m) => m.role === "assistant" && m.blocks.some((b) => b.type === "text"));
    const t = last?.blocks.map((b) => (b.type === "text" ? b.text : "")).join(" ") ?? "";
    return transcript.partialText || t;
  })();

  return { resume, heardNow: heard, active, phase: speakingNow && phase !== "listening" ? ("speaking" as VoicePhase) : phase, toggle, stop, muted, toggleMute, level, outLevel, heard, reply, interrupt };
}
