import { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { strings, useT } from "../i18n";

const S = strings({
  he: {
    placeholder: "sk-ant-...",
    save: "שמור",
    remove: "הסר מפתח",
    hint: "מפתח API של Anthropic מ-console.anthropic.com (חיוב לפי שימוש). נשמר רק במחשב הזה ולא מוצג שוב. אפשר גם Amazon Bedrock או Google Vertex AI דרך משתני הסביבה (CLAUDE_CODE_USE_BEDROCK / CLAUDE_CODE_USE_VERTEX).",
    getKey: "ליצירת מפתח",
  },
  en: {
    placeholder: "sk-ant-...",
    save: "Save",
    remove: "Remove key",
    hint: "An Anthropic API key from console.anthropic.com (usage billing). Stored only on this computer and never shown again. Amazon Bedrock or Google Vertex AI also work through environment variables (CLAUDE_CODE_USE_BEDROCK / CLAUDE_CODE_USE_VERTEX).",
    getKey: "Create a key",
  },
});

/** מפתח ה-API של Anthropic לסשנים של Claude (authMode = apiKey). המפתח נשלח לשרת ולא חוזר */
export default function AnthropicKeyField({ hasKey, onSaved }: { hasKey: boolean; onSaved: () => void }) {
  const t = useT(S);
  const setToast = useStore((s) => s.setToast);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (value: string | null) => {
    setBusy(true);
    try {
      await api.setAnthropicKey(value);
      setKey("");
      onSaved();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && key.trim() && void save(key)}
          placeholder={t("placeholder")}
          className="ltr mono flex-1 min-w-0 px-2 py-1 text-xs rounded-lg bg-surface border"
        />
        <button disabled={busy || !key.trim()} onClick={() => void save(key)} className="btn-primary px-3 py-1 text-xs disabled:opacity-40">
          {t("save")}
        </button>
        {hasKey && (
          <button disabled={busy} onClick={() => void save(null)} className="btn-ghost px-2.5 py-1 text-xs">
            {t("remove")}
          </button>
        )}
      </div>
      <div className="text-[12px] text-muted">
        {t("hint")}{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-blue">
          {t("getKey")}
        </a>
      </div>
    </div>
  );
}
