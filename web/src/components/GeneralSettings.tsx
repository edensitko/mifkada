import { useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { api, type SystemPrefs } from "../api";
import { useStore } from "../store";
import { cn } from "../lib/util";
import { applyLang, resolveLang, strings, useT, type LangSetting } from "../i18n";

const S = strings({
  he: {
    language: "שפה",
    langAuto: "לפי המערכת",
    name: "איך לפנות אליך",
    namePlaceholder: "השם שלך (לא חובה)",
    folders: "תיקיות הפרויקטים",
    foldersHint: "כל תת-תיקייה בתוכן היא פרויקט: היא מופיעה בבחירת פרויקט, במאגרים ובמפה.",
    remove: "הסר",
    add: "הוסף",
    fullPath: "נתיב מלא, למשל ~/projects",
    helpers: "עוזרי רקע",
    helpersHint: 'תקציר "מאז אתמול" בלוח, ושיוך אוטומטי של סשנים לפרויקט. אלה קריאות למודל שצורכות מהמנוי שלך גם כשלא ביקשת, ולכן כבויות כברירת מחדל.',
  },
  en: {
    language: "Language",
    langAuto: "System",
    name: "What should we call you",
    namePlaceholder: "Your name (optional)",
    folders: "Project folders",
    foldersHint: "Every subfolder inside them is a project: it shows up in the project picker, in Repositories and on the Map.",
    remove: "Remove",
    add: "Add",
    fullPath: "A full path, for example ~/projects",
    helpers: "Background helpers",
    helpersHint: 'The "Since yesterday" digest on the dashboard and automatic project assignment for sessions. They call the model and use your subscription even when you didn\'t ask, so they are off by default.',
  },
});

/**
 * ההגדרות הבסיסיות: איך לפנות אליך, איפה הפרויקטים שלך, והאם מותר לקרוא למודל ברקע.
 * משמש גם בעמוד ההגדרות וגם בהפעלה הראשונה (Onboarding).
 */
export default function GeneralSettings({ compact }: { compact?: boolean }) {
  const system = useStore((s) => s.system);
  const setSystemPrefs = useStore((s) => s.setSystemPrefs);
  const setToast = useStore((s) => s.setToast);
  const t = useT(S);
  const [name, setName] = useState(system?.displayName ?? "");
  const [folder, setFolder] = useState("");

  const save = async (patch: Partial<SystemPrefs>) => {
    try {
      setSystemPrefs(await api.setSystem(patch));
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const roots = system?.projectRoots ?? [];
  const addFolder = () => {
    const d = folder.trim();
    if (!d) return;
    if (!/^(~|\/)/.test(d)) return setToast(t("fullPath"));
    setFolder("");
    void save({ projectRoots: [...roots, d] });
  };

  return (
    <div className={cn("space-y-5", compact && "space-y-4")}>
      <div className="space-y-1.5">
        <div className="text-[13px] font-medium">{t("language")}</div>
        <div className="segmented grid grid-cols-3 text-sm max-w-sm">
          {(
            [
              ["auto", t("langAuto")],
              ["he", "עברית"],
              ["en", "English"],
            ] as Array<[LangSetting, string]>
          ).map(([v, label]) => (
            <button
              key={v}
              data-active={(system?.lang ?? "auto") === v}
              onClick={() => void save({ lang: v }).then(() => applyLang(resolveLang(v)))}
              className="py-1"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">{t("name")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== (system?.displayName ?? "") && void save({ displayName: name })}
          placeholder={t("namePlaceholder")}
          className="w-full rounded-lg bg-background border px-3 py-2 text-sm outline-none focus:border-blue/60"
        />
      </label>

      <div className="space-y-1.5">
        <div className="text-[13px] font-medium">{t("folders")}</div>
        <div className="text-[12px] text-muted">{t("foldersHint")}</div>
        {roots.map((r) => (
          <div key={r} className="flex items-center gap-2 rounded-lg bg-[var(--color-fill)] px-3 py-1.5 text-sm">
            <span className="ltr mono text-[12.5px] flex-1 truncate">{r}</span>
            <button onClick={() => void save({ projectRoots: roots.filter((x) => x !== r) })} className="text-muted hover:text-danger" title={t("remove")}>
              <X className="size-4" />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addFolder()}
            placeholder="~/projects"
            className="ltr flex-1 rounded-lg bg-background border px-3 py-2 text-sm mono outline-none focus:border-blue/60"
          />
          <button onClick={addFolder} className="btn-primary rounded-lg px-3 text-sm flex items-center gap-1.5">
            <FolderPlus className="size-4" /> {t("add")}
          </button>
        </div>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={Boolean(system?.aiHelpers)} onChange={(e) => void save({ aiHelpers: e.target.checked })} className="accent-blue size-4 mt-0.5" />
        <span>
          <span className="block text-[13px] font-medium">{t("helpers")}</span>
          <span className="block text-[12px] text-muted">{t("helpersHint")}</span>
        </span>
      </label>
    </div>
  );
}
