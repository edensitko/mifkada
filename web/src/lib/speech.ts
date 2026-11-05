/**
 * הקראה בעברית. שני ספקים:
 * - system: הקולות של macOS (speechSynthesis). אפשר להוריד את Carmit המשופר בהגדרות המערכת.
 * - openai: gpt-4o-mini-tts דרך השרת המקומי (/api/tts). איכות טבעית יותר, הטקסט נשלח ל-OpenAI.
 */
import { lang, pick, strings, tr } from "../i18n";

export interface VoiceSettings {
  provider: "system" | "openai";
  systemVoice: string;
  openaiVoice: string;
  rate: number;
  pitch: number;
}

const S = strings({
  he: {
    code: " קוד. ",
    ttsFailed: "OpenAI TTS נכשל, עוברים לקול המערכת",
    bash: "מריץ פקודה",
    read: "קורא קבצים",
    grep: "מחפש בקוד",
    glob: "מחפש קבצים",
    edit: "עורך קובץ",
    multiEdit: "עורך קבצים",
    write: "כותב קובץ",
    webSearch: "מחפש ברשת",
    webFetch: "פותח אתר",
    agent: "מעביר לסוכן",
    mcp: "משתמש בכלי חיצוני",
  },
  en: {
    code: " Code. ",
    ttsFailed: "OpenAI TTS failed, falling back to the system voice",
    bash: "Running a command",
    read: "Reading files",
    grep: "Searching the code",
    glob: "Looking for files",
    edit: "Editing a file",
    multiEdit: "Editing files",
    write: "Writing a file",
    webSearch: "Searching the web",
    webFetch: "Opening a website",
    agent: "Handing off to an agent",
    mcp: "Using an external tool",
  },
});

/** קידומת השפה של הקולות לפי שפת הממשק, ו-lang של ההקראה כשלא נמצא קול */
const voicePrefix = (): string => pick("he", "en");
const fallbackLang = (): string => pick("he-IL", "en-US");
const isMine = (v: SpeechSynthesisVoice): boolean => v.lang.toLowerCase().startsWith(voicePrefix());

const KEY = "mifkada.voice";
const DEFAULTS: VoiceSettings = { provider: "system", systemVoice: "", openaiVoice: "coral", rate: 1.05, pitch: 1 };

export function getVoiceSettings(): VoiceSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<VoiceSettings>) };
  } catch {
    return DEFAULTS;
  }
}

export function setVoiceSettings(patch: Partial<VoiceSettings>): VoiceSettings {
  const next = { ...getVoiceSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* אין אחסון */
  }
  return next;
}

export function ttsAvailable(): boolean {
  return typeof speechSynthesis !== "undefined";
}

/** הקולות של המערכת, אלה של שפת הממשק קודם. */
export function systemVoices(): SpeechSynthesisVoice[] {
  if (!ttsAvailable()) return [];
  const all = speechSynthesis.getVoices();
  return [...all.filter(isMine), ...all.filter((v) => !isMine(v))];
}

/**
 * הקול שנבחר בהגדרות (באנגלית רק אם הוא קול באנגלית: קול עברי לא יקריא טקסט באנגלית). אחרת ברירת המחדל של השפה:
 * בעברית Carmit (המשופר אם הורד), באנגלית קול en-US משופר, ואז כל קול בשפה.
 */
function pickSystemVoice(name: string): SpeechSynthesisVoice | null {
  const voices = systemVoices();
  const chosen = voices.find((v) => v.name === name);
  if (chosen && (lang() === "he" || isMine(chosen))) return chosen;
  const better = (v: SpeechSynthesisVoice) => /enhanced|premium|משופר/i.test(v.name);
  if (lang() === "he") return voices.find((v) => /carmit/i.test(v.name) && better(v)) ?? voices.find((v) => /carmit/i.test(v.name)) ?? voices.find(isMine) ?? null;
  const us = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-") === "en-us";
  return voices.find((v) => us(v) && better(v)) ?? voices.find((v) => us(v) && /samantha/i.test(v.name)) ?? voices.find(us) ?? voices.find(isMine) ?? null;
}

/** מנקה markdown לפני הקראה: בלוקי קוד, סימני עיצוב, קישורים. */
export function cleanForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, tr(S, "code"))
    .replace(/`[^`]*`/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

let currentAudio: HTMLAudioElement | null = null;
const speakingListeners = new Set<(on: boolean) => void>();
export function onSpeakingChange(cb: (on: boolean) => void): () => void {
  speakingListeners.add(cb);
  return () => speakingListeners.delete(cb);
}
const setSpeaking = (on: boolean) => speakingListeners.forEach((cb) => cb(on));

function speakSystem(t: string, s: VoiceSettings): Promise<void> {
  return new Promise((resolve) => {
    if (!ttsAvailable()) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t.slice(0, 2500));
    const v = pickSystemVoice(s.systemVoice);
    if (v) u.voice = v;
    u.lang = v?.lang ?? fallbackLang();
    u.rate = s.rate;
    u.pitch = s.pitch;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

/** בקשה ל-OpenAI TTS. מחזירה את האודיו (blob URL), כדי שאפשר יהיה להכין את המשפט הבא בזמן שהנוכחי מושמע. */
function fetchOpenai(t: string, s: VoiceSettings): Promise<string> {
  return fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t, voice: s.openaiVoice, speed: s.rate }) }).then(async (r) => {
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `TTS ${r.status}`);
    return URL.createObjectURL(await r.blob());
  });
}

/* עוצמת הקול שיוצא מהרמקול, כדי שהכדור יפעם לפי הדיבור עצמו (רק בקול של OpenAI; הקול של המק לא חשוף) */
const outputListeners = new Set<(level: number) => void>();
export function onOutputLevel(cb: (level: number) => void): () => void {
  outputListeners.add(cb);
  return () => outputListeners.delete(cb);
}
let outCtx: AudioContext | null = null;

function playUrl(url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const a = new Audio(url);
    currentAudio = a;
    let raf = 0;
    try {
      outCtx ??= new AudioContext();
      const src = outCtx.createMediaElementSource(a);
      const an = outCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      an.connect(outCtx.destination);
      const buf = new Float32Array(an.fftSize);
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 5);
        outputListeners.forEach((cb) => cb(lvl));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      /* בלי ניתוח עוצמה, רק השמעה */
    }
    a.onended = a.onerror = a.onpause = () => {
      cancelAnimationFrame(raf);
      outputListeners.forEach((cb) => cb(0));
      URL.revokeObjectURL(url);
      if (currentAudio === a) currentAudio = null;
      resolve();
    };
    void a.play().catch(() => resolve());
  });
}

/** מקריא ומסתיים כשההקראה נגמרת (או נקטעת). אם OpenAI נכשל, נופל לקול של המערכת. */
export async function speak(text: string): Promise<void> {
  const t = cleanForSpeech(text);
  if (!t) return;
  stopPlayback();
  const s = getVoiceSettings();
  setSpeaking(true);
  try {
    if (s.provider === "openai") {
      try {
        await playUrl(await fetchOpenai(t, s));
        return;
      } catch (e) {
        console.warn(tr(S, "ttsFailed"), e);
      }
    }
    await speakSystem(t, s);
  } finally {
    setSpeaking(false);
  }
}

/**
 * תור הקראה: הודעות שמגיעות בזמן שמשהו מוקרא מחכות בתור ולא קוטעות.
 * עם OpenAI, האודיו של המשפט הבא נשלף כבר בזמן שהנוכחי מושמע, כך שאין הפסקה בין משפטים.
 */
interface Item {
  text: string;
  audio?: Promise<string>;
}
const queue: Item[] = [];
let draining = false;
let idleWaiters: Array<() => void> = [];

export function enqueueSpeech(text: string): void {
  const t = cleanForSpeech(text);
  if (!t) return;
  queue.push({ text: t });
  prefetch();
  void drain();
}

function prefetch(): void {
  const s = getVoiceSettings();
  if (s.provider !== "openai") return;
  for (const it of queue.slice(0, 2)) if (!it.audio) it.audio = fetchOpenai(it.text, s);
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  setSpeaking(true);
  try {
    while (queue.length) {
      const it = queue.shift()!;
      prefetch();
      if (it.audio) {
        try {
          await playUrl(await it.audio);
          continue;
        } catch (e) {
          console.warn(tr(S, "ttsFailed"), e);
        }
      }
      await speakSystem(it.text, getVoiceSettings()).catch(() => undefined);
    }
  } finally {
    draining = false;
    setSpeaking(false);
    const w = idleWaiters;
    idleWaiters = [];
    w.forEach((r) => r());
  }
}

/** מתממש כשהתור ריק ושום דבר לא מוקרא. */
export function whenSpeechIdle(): Promise<void> {
  if (!draining && queue.length === 0) return Promise.resolve();
  return new Promise((r) => idleWaiters.push(r));
}

export function isSpeechBusy(): boolean {
  return draining || queue.length > 0;
}

/** עוצר רק את מה שמושמע עכשיו, בלי לרוקן את התור. */
function stopPlayback(): void {
  if (ttsAvailable()) speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

export function stopSpeaking(): void {
  queue.length = 0;
  stopPlayback();
  setSpeaking(false);
}

/** המיקרופון עם ביטול הד של הדפדפן: הוא מנכה את מה שהדף עצמו משמיע, כך שהקול של Claude לא נקלט כדיבור. */
const MIC: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

/**
 * קטיעה בדיבור (barge-in), כמו ב-ChatGPT: בזמן שהקול מדבר, המיקרופון מקשיב,
 * ואם המשתמש מדבר ברצף (~350ms מעל הסף), ההקראה נעצרת ו-onInterrupt נקרא.
 */
export async function monitorBargeIn(signal: AbortSignal, onInterrupt: () => void): Promise<void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(MIC);
  } catch {
    return;
  }
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  let loudSince = 0;
  let noise = 0.02;
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (signal.aborted) return resolve();
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (now - started < 500) noise = Math.max(noise, rms); // חצי שנייה ראשונה: לומדים את רמת ההד שנשארת
      const loud = rms > Math.max(0.06, noise * 2.5);
      if (loud) {
        loudSince ||= now;
        if (now - loudSince > 350) {
          onInterrupt();
          return resolve();
        }
      } else loudSince = 0;
      setTimeout(tick, 50);
    };
    tick();
  });
  stream.getTracks().forEach((t) => t.stop());
  void ctx.close();
}

/**
 * מקליט עד שהדובר שותק: מחכה לדיבור, ואז עוצר אחרי silenceMs של שקט.
 * מחזיר null אם לא היה דיבור בכלל (idleMs) או שבוטל.
 */
export async function recordUntilSilence(opts: { silenceMs?: number; idleMs?: number; maxMs?: number; signal?: AbortSignal; onLevel?: (level: number, speaking: boolean) => void } = {}): Promise<Blob | null> {
  const { silenceMs = 1100, idleMs = 9000, maxMs = 30000, signal, onLevel } = opts;
  const stream = await navigator.mediaDevices.getUserMedia(MIC);
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
  rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  rec.start(200);
  const started = Date.now();
  let spokeAt = 0;
  let lastLoud = 0;
  let noise = 0.01;
  const cleanup = () => {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
  const spoke = await new Promise<boolean>((resolve) => {
    const tick = () => {
      if (signal?.aborted) return resolve(false);
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (!spokeAt) noise = noise * 0.95 + rms * 0.05; // רצפת רעש מסתגלת לפני הדיבור
      const loud = rms > Math.max(0.03, noise * 3.5);
      const now = Date.now();
      if (loud) {
        lastLoud = now;
        if (!spokeAt) spokeAt = now;
      }
      onLevel?.(rms, loud);
      // דיבור אמיתי = לפחות 450ms של קול. קליק או רעש קצר לא נחשבים
      if (spokeAt && now - lastLoud > silenceMs) return resolve(lastLoud - spokeAt >= 450);
      if (!spokeAt && now - started > idleMs) return resolve(false);
      if (now - started > maxMs) return resolve(Boolean(spokeAt));
      setTimeout(tick, 80);
    };
    tick();
  });
  const blob = await new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" }));
    rec.stop();
  });
  cleanup();
  return spoke && !signal?.aborted ? blob : null;
}



/** הקלטה מהמיקרופון ל-webm/opus, עד שעוצרים. */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, { mimeType: "audio/webm;codecs=opus" });
    this.rec.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.rec.start(250);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec) return resolve(new Blob());
      rec.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this.rec = null;
        resolve(new Blob(this.chunks, { type: "audio/webm" }));
      };
      rec.stop();
    });
  }
}

/* ---------- צלילים קצרים לשיחה הקולית ---------- */

let ackCtx: AudioContext | null = null;
/** צליל "שמעתי" קצר ועדין (שני טונים עולים), כמו ב-Siri: מסמן שההודעה נקלטה ו-Claude כבר עובד */
export function playAck(): void {
  try {
    ackCtx ??= new AudioContext();
    const ctx = ackCtx;
    const t0 = ctx.currentTime + 0.01;
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const s = t0 + i * 0.09;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.07, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(s);
      o.stop(s + 0.18);
    }
  } catch {
    /* אין שמע */
  }
}

/** עדכון קולי קצר כש-Claude מריץ כלי בזמן שיחה קולית, לכל היותר פעם ב-10 שניות ורק כשאין הקראה */
const TOOL_HINTS: Record<string, keyof typeof S.he> = {
  Bash: "bash",
  Read: "read",
  Grep: "grep",
  Glob: "glob",
  Edit: "edit",
  MultiEdit: "multiEdit",
  Write: "write",
  WebSearch: "webSearch",
  WebFetch: "webFetch",
  Task: "agent",
  Agent: "agent",
};
let lastHint = 0;
export function speakToolHint(tool: string): void {
  const now = Date.now();
  if (now - lastHint < 10_000 || isSpeechBusy()) return;
  const key = TOOL_HINTS[tool] ?? (tool.startsWith("mcp__") ? "mcp" : null);
  const h = key ? tr(S, key) : null;
  if (!h) return;
  lastHint = now;
  enqueueSpeech(h + "...");
}
