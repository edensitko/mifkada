import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, X, MessageSquare, Captions, CaptionsOff, Settings2 } from "lucide-react";
import VoiceQuickSettings from "./VoiceQuickSettings";
import { cleanForSpeech } from "../lib/speech";
import type { VoicePhase } from "../lib/useVoiceConversation";
import OrbCanvas from "./OrbCanvas";
import { strings, useT } from "../i18n";

const S = strings({
  he: {
    idle: "המיקרופון מושתק",
    listening: "מקשיב",
    transcribing: "מבין",
    thinking: "חושב",
    speaking: "מדבר",
    backHint: "חזרה לצ'אט (Esc). השיחה ממשיכה",
    back: "לצ'אט",
    tapToInterrupt: "לחץ כדי לקטוע",
    interruptHint: "· דבר או לחץ על הכדור כדי לקטוע",
    voiceSettings: "הגדרות קול",
    hideCaptions: "הסתר כתוביות",
    showCaptions: "הצג כתוביות",
    unmute: "הפעל מיקרופון (רווח)",
    mute: "השתק (רווח)",
    end: "סיים שיחה",
  },
  en: {
    idle: "Microphone muted",
    listening: "Listening",
    transcribing: "Understanding",
    thinking: "Thinking",
    speaking: "Speaking",
    backHint: "Back to chat (Esc). The call keeps going",
    back: "Chat",
    tapToInterrupt: "Click to interrupt",
    interruptHint: "· Speak or click the orb to interrupt",
    voiceSettings: "Voice settings",
    hideCaptions: "Hide captions",
    showCaptions: "Show captions",
    unmute: "Unmute (Space)",
    mute: "Mute (Space)",
    end: "End call",
  },
});

function lastSentence(text: string, max = 150): string {
  const t = cleanForSpeech(text);
  if (t.length <= max) return t;
  const cut = t.slice(-max);
  const i = cut.search(/[.!?]\s/);
  return "…" + (i >= 0 && i < 80 ? cut.slice(i + 2) : cut);
}

function useTimer(): string {
  const start = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.floor((now - start.current) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** גלי קול קטנים מתחת לכדור, כמו באייפון. */
function Bars({ level, active }: { level: number; active: boolean }) {
  const shape = [0.45, 0.75, 1, 0.75, 0.45];
  return (
    <div className="voice-bars" aria-hidden="true">
      {shape.map((k, i) => (
        <span key={i} style={{ height: `${active ? 6 + Math.min(1, level * 1.4) * 26 * k : 6}px` }} />
      ))}
    </div>
  );
}

/** מסך שיחה קולית בסגנון ChatGPT: כדור חי, זוהר ברקע, טיימר, כתוביות וסרגל כפתורים מזכוכית. */
export default function VoiceOrb({
  phase,
  level,
  outLevel,
  onTapOrb,
  muted,
  heard,
  reply,
  color,
  name,
  onMute,
  onEnd,
  onHide,
}: {
  phase: VoicePhase;
  level: number;
  outLevel: number;
  onTapOrb: () => void;
  muted: boolean;
  heard: string;
  reply: string;
  color: string;
  name: string;
  onMute: () => void;
  onEnd: () => void;
  onHide: () => void;
}) {
  const timer = useTimer();
  const t = useT(S);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [captions, setCaptions] = useState(() => localStorage.getItem("mifkada.captions") !== "0");
  const toggleCaptions = () => {
    localStorage.setItem("mifkada.captions", captions ? "0" : "1");
    setCaptions(!captions);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onHide();
      if (e.key === " " && (e.target as HTMLElement)?.tagName !== "BUTTON") {
        e.preventDefault();
        onMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onHide, onMute]);

  const shown: VoicePhase = muted ? "idle" : phase;
  const orbLevel = shown === "listening" ? level : shown === "speaking" ? outLevel || 0.25 : 0;

  return (
    <div className={"voice-stage phase-" + shown} style={{ "--orb": color } as React.CSSProperties}>
      <div className="voice-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="voice-top">
        <div className="voice-who">
          <span className="voice-live" />
          <span className="font-semibold">{name}</span>
          <span className="tabular text-muted">{timer}</span>
        </div>
        <button onClick={onHide} className="voice-chip" title={t("backHint")}>
          <MessageSquare className="size-4" /> {t("back")}
        </button>
      </div>

      <div className="voice-center">
        <button type="button" onClick={onTapOrb} className="voice-orb-btn" title={phase === "speaking" ? t("tapToInterrupt") : ""}>
          <OrbCanvas level={orbLevel} phase={shown} color={color} size={340} />
        </button>
        <div className="voice-state">
          {shown === "listening" ? <Bars level={level} active /> : <span className={"voice-dots" + (shown === "thinking" || shown === "transcribing" ? " is-on" : "")} />}
          <span>{t(shown)}</span>
          {shown === "speaking" && <span className="text-muted text-xs">{t("interruptHint")}</span>}
        </div>
        <div className="voice-captions" style={{ opacity: captions ? 1 : 0 }}>
          {heard && (
            <p key={"h" + heard} className="voice-heard" dir="auto">
              {lastSentence(heard, 110)}
            </p>
          )}
          {reply && (phase === "speaking" || phase === "thinking") && (
            <p key={"r" + reply.length} className="voice-reply" dir="auto">
              {lastSentence(reply)}
            </p>
          )}
        </div>
      </div>

      {settingsOpen && (
        <div className="voice-settings-wrap" onClick={() => setSettingsOpen(false)}>
          <VoiceQuickSettings onClose={() => setSettingsOpen(false)} />
        </div>
      )}
      <div className="voice-dock">
        <button onClick={() => setSettingsOpen((o) => !o)} className="voice-btn" data-on={settingsOpen} title={t("voiceSettings")}>
          <Settings2 className="size-5" />
        </button>
        <button onClick={toggleCaptions} className="voice-btn" data-on={captions} title={captions ? t("hideCaptions") : t("showCaptions")}>
          {captions ? <Captions className="size-5" /> : <CaptionsOff className="size-5" />}
        </button>
        <button onClick={onMute} className={"voice-btn" + (muted ? " is-muted" : "")} title={muted ? t("unmute") : t("mute")}>
          {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </button>
        <button onClick={onEnd} className="voice-btn is-end" title={t("end")}>
          <X className="size-6" />
        </button>
      </div>
    </div>
  );
}
