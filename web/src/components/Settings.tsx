import { SETTINGS_COLORS } from "../lib/settingsColors";
import { useEffect, useState } from "react";
import { Volume2, KeyRound, Check, Trash2, Info } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { cn } from "../lib/util";
import { getVoiceSettings, setVoiceSettings, speak, stopSpeaking, systemVoices, type VoiceSettings } from "../lib/speech";
import { pick, strings, useT } from "../i18n";

const S = strings({
  he: {
    sample: "שלום, זה הקול של מפקדה. יש שתי משימות שממתינות לבדיקה, ובדיקת השרת של הבוקר עברה בלי ממצאים.",
    keySaved: "המפתח נשמר במחשב",
    title: "קול והקראה",
    stop: "עצור",
    test: "נסה את הקול",
    macVoice: "קול של המק (מקומי)",
    openaiVoice: "OpenAI (טבעי יותר)",
    voice: "קול",
    auto: "אוטומטי (הכי טוב בעברית)",
    pitch: "גובה צליל",
    carmit1: "במק מותקנת רק הגרסה הבסיסית של כרמית. גרסה משופרת, טבעית בהרבה, יורדת בחינם:",
    carmit2: "הגדרות המערכת ← נגישות ← תוכן מדובר ← קול המערכת ← ניהול קולות ← עברית ← כרמית (משופר או פרימיום).",
    carmit3: "אחרי ההורדה צריך לסגור את מפקדה (⌘Q) ולפתוח מחדש, ואז הקול יופיע ברשימה.",
    apiKey: "מפתח API",
    storedLocally: "שמור במחשב",
    remove: "הסר",
    save: "שמור",
    openaiNote: "הטקסט שמוקרא נשלח ל-OpenAI (מודל gpt-4o-mini-tts), בערך סנט לכל כמה דקות הקראה. המפתח נשמר רק במחשב ולא חוזר לממשק. אם הקריאה ל-OpenAI נכשלת, ההקראה עוברת אוטומטית לקול של המק.",
    rate: "מהירות",
  },
  en: {
    sample: "Hi, this is the voice of Mifkada. Two tasks are waiting for review, and this morning's server check passed with no findings.",
    keySaved: "Key saved on this Mac",
    title: "Voice and read aloud",
    stop: "Stop",
    test: "Try the voice",
    macVoice: "Mac voice (local)",
    openaiVoice: "OpenAI (more natural)",
    voice: "Voice",
    auto: "Automatic (best Hebrew voice)",
    pitch: "Pitch",
    carmit1: "Only the basic version of Carmit is installed on this Mac. An enhanced, much more natural version is a free download:",
    carmit2: "System Settings → Accessibility → Spoken Content → System voice → Manage voices → Hebrew → Carmit (Enhanced or Premium).",
    carmit3: "After the download, quit Mifkada (⌘Q) and reopen it, and the voice will appear in the list.",
    apiKey: "API key",
    storedLocally: "Saved on this Mac",
    remove: "Remove",
    save: "Save",
    openaiNote: "The text being read is sent to OpenAI (gpt-4o-mini-tts model), roughly a cent per few minutes of speech. The key is stored only on this Mac and never sent back to the interface. If the OpenAI call fails, reading falls back to the Mac voice automatically.",
    rate: "Speed",
  },
});

// getters: התיאור מחושב בכל קריאה, לפי השפה הנוכחית
const OPENAI_VOICES: Array<{ id: string; label: string }> = [
  { id: "coral", get label() { return pick("Coral - חמה", "Coral - warm"); } },
  { id: "marin", get label() { return pick("Marin - טבעית", "Marin - natural"); } },
  { id: "cedar", get label() { return pick("Cedar - עמוקה", "Cedar - deep"); } },
  { id: "sage", get label() { return pick("Sage - רגועה", "Sage - calm"); } },
  { id: "nova", get label() { return pick("Nova - אנרגטית", "Nova - energetic"); } },
  { id: "shimmer", get label() { return pick("Shimmer - רכה", "Shimmer - soft"); } },
  { id: "alloy", get label() { return pick("Alloy - ניטרלית", "Alloy - neutral"); } },
  { id: "ash", get label() { return pick("Ash - ישירה", "Ash - direct"); } },
  { id: "verse", get label() { return pick("Verse - מבעית", "Verse - expressive"); } },
  { id: "onyx", get label() { return pick("Onyx - נמוכה", "Onyx - low"); } },
];

/** קטע הקול וההקראה בעמוד ההגדרות. */
export function VoiceSection() {
  const setToast = useStore((s) => s.setToast);
  const [v, setV] = useState<VoiceSettings>(getVoiceSettings());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(systemVoices());
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const t = useT(S);

  useEffect(() => {
    const load = () => setVoices(systemVoices());
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    api.settings().then((s) => setHasKey(s.hasOpenaiKey)).catch(() => undefined);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const update = (patch: Partial<VoiceSettings>) => setV(setVoiceSettings(patch));
  const test = async () => {
    if (testing) {
      stopSpeaking();
      setTesting(false);
      return;
    }
    setTesting(true);
    try {
      await speak(t("sample"));
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setTesting(false);
    }
  };
  const saveKey = async () => {
    try {
      const r = await api.setOpenaiKey(key.trim());
      setHasKey(r.hasOpenaiKey);
      setKey("");
      setToast(t("keySaved"));
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const removeKey = async () => {
    const r = await api.setOpenaiKey(null);
    setHasKey(r.hasOpenaiKey);
    if (v.provider === "openai") update({ provider: "system" });
  };

  const hebrew = voices.filter((x) => x.lang.toLowerCase().startsWith("he"));
  const others = voices.filter((x) => !x.lang.toLowerCase().startsWith("he"));
  const onlyBasicCarmit = hebrew.length <= 1;

  return (
        <section id="voice" className="card p-5 space-y-5 scroll-mt-6">
          <div className="flex items-center gap-2">
            <span className="ios-icon" style={{ background: SETTINGS_COLORS.voice }}>
              <Volume2 />
            </span>
            <h2 className="font-semibold text-lg">{t("title")}</h2>
            <button onClick={test} className="ms-auto btn-primary px-4 py-1.5 text-sm">
              {testing ? t("stop") : t("test")}
            </button>
          </div>

          <div className="segmented grid grid-cols-2 text-sm max-w-sm">
            <button data-active={v.provider === "system"} onClick={() => update({ provider: "system" })} className="py-1.5">
              {t("macVoice")}
            </button>
            <button data-active={v.provider === "openai"} onClick={() => update({ provider: "openai" })} className="py-1.5">
              {t("openaiVoice")}
            </button>
          </div>

          {v.provider === "system" ? (
            <div className="space-y-3">
              <label className="flex items-center gap-3 text-sm">
                <span className="w-24 text-muted">{t("voice")}</span>
                <select value={v.systemVoice} onChange={(e) => update({ systemVoice: e.target.value })} className="px-2 py-1.5 text-sm flex-1 max-w-sm">
                  <option value="">{t("auto")}</option>
                  {hebrew.map((x) => (
                    <option key={x.name} value={x.name}>
                      {x.name}
                    </option>
                  ))}
                  {others.length > 0 && <option disabled>──────</option>}
                  {others.map((x) => (
                    <option key={x.name} value={x.name}>
                      {x.name} ({x.lang})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-3 text-sm">
                <span className="w-24 text-muted">{t("pitch")}</span>
                <input type="range" min={0.7} max={1.4} step={0.05} value={v.pitch} onChange={(e) => update({ pitch: Number(e.target.value) })} className="flex-1 max-w-sm accent-blue" />
                <span className="tabular w-10 text-muted">{v.pitch.toFixed(2)}</span>
              </label>
              {onlyBasicCarmit && (
                <div className="flex gap-2 rounded-xl bg-blue/8 p-3 text-sm">
                  <Info className="size-4 text-blue shrink-0 mt-0.5" />
                  <div>
                    {t("carmit1")}
                    <div className="mt-1 text-muted">{t("carmit2")}</div>
                    <div className="mt-1 text-muted">{t("carmit3")}</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <label className="flex items-center gap-3 text-sm">
                <span className="w-24 text-muted">{t("voice")}</span>
                <select value={v.openaiVoice} onChange={(e) => update({ openaiVoice: e.target.value })} className="px-2 py-1.5 text-sm flex-1 max-w-sm">
                  {OPENAI_VOICES.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-3 text-sm">
                <span className="w-24 text-muted">{t("apiKey")}</span>
                {hasKey ? (
                  <span className="flex items-center gap-2">
                    <Check className="size-4 text-teal" /> {t("storedLocally")}
                    <button onClick={removeKey} className="text-danger flex items-center gap-1 text-xs hover:underline">
                      <Trash2 className="size-3.5" /> {t("remove")}
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2 flex-1 max-w-sm">
                    <KeyRound className="size-4 text-muted shrink-0" />
                    <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-..." className="ltr flex-1 rounded-lg bg-background border px-2 py-1.5 text-sm outline-none focus:border-blue/60" />
                    <button onClick={saveKey} disabled={!key.trim()} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40">
                      {t("save")}
                    </button>
                  </span>
                )}
              </div>
              <div className="text-xs text-muted leading-relaxed">
                {t("openaiNote")}
              </div>
            </div>
          )}

          <label className="flex items-center gap-3 text-sm">
            <span className="w-24 text-muted">{t("rate")}</span>
            <input type="range" min={0.8} max={1.5} step={0.05} value={v.rate} onChange={(e) => update({ rate: Number(e.target.value) })} className="flex-1 max-w-sm accent-blue" />
            <span className={cn("tabular w-10 text-muted")}>{v.rate.toFixed(2)}</span>
          </label>
        </section>
  );
}
