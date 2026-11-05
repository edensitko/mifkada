import { useEffect, useState } from "react";
import { api, type ProviderInfo } from "../api";
import type { PermissionMode } from "../../../shared/protocol";

/** רשימת הספקים, נטענת פעם אחת לכל החלון. refreshProviders() אחרי שינוי בהגדרות */
let cache: ProviderInfo[] | null = null;
let loading: Promise<ProviderInfo[]> | null = null;
const listeners = new Set<(l: ProviderInfo[]) => void>();

export function refreshProviders(): Promise<ProviderInfo[]> {
  loading = api
    .providers()
    .then((l) => {
      cache = l;
      for (const f of listeners) f(l);
      return l;
    })
    .catch(() => cache ?? []);
  return loading;
}

export function useProviders(): ProviderInfo[] {
  const [list, setList] = useState<ProviderInfo[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setList);
    if (!cache && !loading) void refreshProviders();
    return () => void listeners.delete(setList);
  }, []);
  return list;
}

export const isClaude = (provider: string | null | undefined) => !provider || provider === "claude";

/**
 * המצבים שספק שאינו Claude יכול לקבל, לפני שהסשן נפתח (אחר כך: caps.modes, מה שהסוכן באמת מציע).
 * השרת ממפה אותם למצבים של הסוכן (pickMode) ולא בוחר אף פעם מצב "בלי לשאול". auto = Auto review של Codex
 */
export const ACP_MODES: PermissionMode[] = ["default", "acceptEdits", "plan", "auto"];

export function providerLabel(id: string | null | undefined, list: ProviderInfo[]): string {
  if (isClaude(id)) return "Claude";
  return list.find((p) => p.id === id)?.label ?? id!;
}
