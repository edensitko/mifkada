import { useProviders, isClaude } from "../lib/providers";
import { strings, useT } from "../i18n";

const S = strings({
  he: { notInstalled: "{label} (לא מותקן)" },
  en: { notInstalled: "{label} (not installed)" },
});

/** בחירת ספק (Claude, Codex...): ספקים פעילים שהפקודה שלהם קיימת במחשב, ומה שכבר נבחר */
export function ProviderSelect({ value, onChange, className }: { value: string | null | undefined; onChange: (v: string) => void; className?: string }) {
  const t = useT(S);
  const list = useProviders().filter((p) => (p.enabled && p.available) || p.id === value);
  return (
    <select value={isClaude(value) ? "claude" : value!} onChange={(e) => onChange(e.target.value)} className={className ?? "px-2 py-1 text-sm"}>
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.available ? p.label : t("notInstalled", { label: p.label })}
        </option>
      ))}
    </select>
  );
}

/** האם יש בכלל בחירה: ספק פעיל ומותקן אחד לפחות חוץ מ-Claude */
export function useHasProviders(): boolean {
  return useProviders().some((p) => !isClaude(p.id) && p.enabled && p.available);
}
