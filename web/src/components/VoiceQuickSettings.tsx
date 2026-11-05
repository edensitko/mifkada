import { useEffect, useState } from "react";
import { getVoiceSettings, setVoiceSettings, speak, systemVoices, type VoiceSettings } from "../lib/speech";
import { api } from "../api";
import { useStore } from "../store";
import { strings, useT } from "../i18n";

const S = strings({
  he: {
    title: "הגדרות קול",
    macVoice: "קול של המק",
    noKey: "אין מפתח OpenAI עדיין. מוסיפים אותו בהגדרות המלאות.",
    voice: "קול",
    auto: "אוטומטי",
    rate: "מהירות",
    sample: "ככה אני נשמע עכשיו. נוח לך?",
    test: "נסה",
    all: "כל ההגדרות",
  },
  en: {
    title: "Voice settings",
    macVoice: "Mac voice",
    noKey: "No OpenAI key yet. Add it in the full settings.",
    voice: "Voice",
    auto: "Automatic",
    rate: "Speed",
    sample: "This is how I sound now. Does it work for you?",
    test: "Try",
    all: "All settings",
  },
});

const OPENAI_VOICES = ["marin", "coral", "cedar", "sage", "nova", "shimmer", "alloy", "ash", "verse", "onyx"];

/** הגדרות קול מהירות מתוך מסך השיחה: ספק, קול, מהירות, ונסה. */
export default function VoiceQuickSettings({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState<VoiceSettings>(getVoiceSettings());
  const [hasKey, setHasKey] = useState(true);
  const select = useStore((s) => s.select);
  const t = useT(S);
  const hebrew = systemVoices().filter((x) => x.lang.toLowerCase().startsWith("he"));
  useEffect(() => {
    api.settings().then((s) => setHasKey(s.hasOpenaiKey)).catch(() => undefined);
  }, []);
  const update = (p: Partial<VoiceSettings>) => setV(setVoiceSettings(p));

  return (
    <div className="voice-settings" onClick={(e) => e.stopPropagation()}>
      <div className="font-semibold mb-3">{t("title")}</div>
      <div className="segmented grid grid-cols-2 text-xs mb-3">
        <button data-active={v.provider === "system"} onClick={() => update({ provider: "system" })} className="py-1.5">
          {t("macVoice")}
        </button>
        <button data-active={v.provider === "openai"} onClick={() => update({ provider: "openai" })} className="py-1.5">
          OpenAI
        </button>
      </div>
      {v.provider === "openai" && !hasKey && <div className="text-xs text-warn mb-2">{t("noKey")}</div>}
      <label className="flex items-center justify-between gap-3 text-sm mb-2.5">
        <span className="text-muted">{t("voice")}</span>
        {v.provider === "openai" ? (
          <select value={v.openaiVoice} onChange={(e) => update({ openaiVoice: e.target.value })} className="px-2 py-1 text-sm w-40">
            {OPENAI_VOICES.map((x) => (
              <option key={x} value={x}>
                {x[0].toUpperCase() + x.slice(1)}
              </option>
            ))}
          </select>
        ) : (
          <select value={v.systemVoice} onChange={(e) => update({ systemVoice: e.target.value })} className="px-2 py-1 text-sm w-40">
            <option value="">{t("auto")}</option>
            {hebrew.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className="flex items-center justify-between gap-3 text-sm mb-3">
        <span className="text-muted">{t("rate")}</span>
        <input type="range" min={0.8} max={1.5} step={0.05} value={v.rate} onChange={(e) => update({ rate: Number(e.target.value) })} className="w-40 accent-blue" />
      </label>
      <div className="flex gap-2">
        <button onClick={() => void speak(t("sample"))} className="btn-primary flex-1 py-1.5 text-sm">
          {t("test")}
        </button>
        <button
          onClick={() => {
            onClose();
            select({ kind: "settings" });
          }}
          className="btn-ghost flex-1 py-1.5 text-sm"
        >
          {t("all")}
        </button>
      </div>
    </div>
  );
}
