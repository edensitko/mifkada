import { useState, type CSSProperties } from "react";
import { Palette } from "lucide-react";
import { useStore } from "../store";
import type { AgentTheme, SessionMeta } from "../../../shared/protocol";
import { cn } from "../lib/util";
import { BACKGROUNDS, SWATCHES } from "../lib/sessionStyle";
import Avatar from "./Avatar";
import { strings, useT, tr } from "../i18n";

const S = strings({
  he: {
    noAgent: "ללא אייג'נט",
    badImage: "לא הצלחתי לקרוא את התמונה",
    color: "צבע",
    image: "תמונה",
    replace: "החלף",
    pickImage: "בחר תמונה",
    remove: "הסר",
    emoji: "אימוג'י או אות",
    name: "שם",
    cancel: "ביטול",
    save: "שמירה",
    notImage: "זה לא קובץ תמונה",
    sessionStyle: "עיצוב הסשן הזה",
    imageOf: "תמונה · {label}",
    dropHint: "גוררים לכאן תמונה, או בוחרים קובץ. נשמר מיד.",
    inherit: "כמו הפרויקט/האייג'נט",
    otherColor: "צבע אחר",
    background: "רקע",
    plain: "רגיל",
    scheme: "ערכת צבעים",
    schemeApp: "כמו האפליקציה",
    light: "בהיר",
    dark: "כהה",
  },
  en: {
    noAgent: "No agent",
    badImage: "Couldn't read the image",
    color: "Color",
    image: "Image",
    replace: "Replace",
    pickImage: "Choose image",
    remove: "Remove",
    emoji: "Emoji or letter",
    name: "Name",
    cancel: "Cancel",
    save: "Save",
    notImage: "That's not an image file",
    sessionStyle: "Style this session",
    imageOf: "Image · {label}",
    dropHint: "Drop an image here, or choose a file. Saved right away.",
    inherit: "Same as the project/agent",
    otherColor: "Custom color",
    background: "Background",
    plain: "Plain",
    scheme: "Color scheme",
    schemeApp: "Same as the app",
    light: "Light",
    dark: "Dark",
  },
});

export function AgentSelect({ value, onChange, disabled, className }: { value: string | null; onChange: (slug: string | null) => void; disabled?: boolean; className?: string }) {
  const agents = useStore((s) => s.agents);
  const t = useT(S);
  return (
    <select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className={className ?? "rounded-lg bg-surface-2/80 border px-2 py-1 text-sm disabled:opacity-50"}>
      <option value="">{t("noAgent")}</option>
      {agents.map((a) => (
        <option key={a.slug} value={a.slug}>
          {a.emoji} {a.name}
        </option>
      ))}
    </select>
  );
}

/** קובץ תמונה → ריבוע ממורכז של 160px כ-data URL (webp), כדי שיישמר קטן בתוך themes.json */
export function squareImage(file: File, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/webp", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(tr(S, "badImage")));
    };
    img.src = url;
  });
}

/** עורך עיצוב משותף לאייג'נט ולפרויקט: צבע, אימוג'י, תמונה ושם תצוגה. השמירה בידי הקורא. */
export function ThemeEditor({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  initial: { color: string; emoji: string; name: string; image?: string };
  onSave: (t: Pick<Required<AgentTheme>, "color" | "emoji" | "displayName" | "image">) => Promise<void>;
  onClose: () => void;
}) {
  const [color, setColor] = useState(initial.color);
  const [emoji, setEmoji] = useState(initial.emoji);
  const [name, setName] = useState(initial.name);
  /** "" = בלי תמונה (השרת מוחק) */
  const [image, setImage] = useState(initial.image ?? "");
  const [imgError, setImgError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT(S);
  const pickImage = async (f: File | undefined) => {
    if (!f) return;
    setImgError(null);
    try {
      setImage(await squareImage(f));
    } catch (e) {
      setImgError((e as Error).message);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ color, emoji, displayName: name, image });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="no-drag absolute top-full mt-2 end-0 z-30 w-72 card p-3 shadow-2xl space-y-2 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Palette className="size-4 text-accent" /> {title}
      </div>
      <label className="flex items-center justify-between gap-2">
        {t("color")}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-14 bg-transparent cursor-pointer" />
      </label>
      <div className="flex items-center justify-between gap-2">
        {t("image")}
        <div className="flex items-center gap-2">
          {image ? <img src={image} alt="" className="size-8 rounded-[26%] object-cover" /> : null}
          <label className="rounded-lg bg-background border px-2 py-1 cursor-pointer hover:bg-surface-2">
            {image ? t("replace") : t("pickImage")}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => void pickImage(e.target.files?.[0])} />
          </label>
          {image && (
            <button onClick={() => setImage("")} className="text-xs text-danger hover:underline">
              {t("remove")}
            </button>
          )}
        </div>
      </div>
      {imgError && <div className="text-xs text-danger">{imgError}</div>}
      <label className="flex items-center justify-between gap-2">
        {t("emoji")}
        <input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-16 rounded-lg bg-background border px-2 py-1 text-center" />
      </label>
      <label className="flex items-center justify-between gap-2">
        {t("name")}
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-40 rounded-lg bg-background border px-2 py-1" />
      </label>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onClose} className="rounded-lg px-3 py-1 hover:bg-surface-2">
          {t("cancel")}
        </button>
        <button onClick={save} disabled={busy} className="rounded-lg bg-accent/25 hover:bg-accent/40 px-3 py-1 disabled:opacity-50">
          {t("save")}
        </button>
      </div>
    </div>
  );
}

/**
 * עיצוב לסשן הזה בלבד: צבע, רקע וערכת צבעים. כל שינוי נראה מיד (onPreview) ונשמר ב"שמירה";
 * "ביטול" מחזיר את מה שהיה. "לכל הפרויקט" פותח את העורך הישן שחל על כל הסשנים של הפרויקט/האייג'נט.
 */
export function SessionThemeEditor({
  initial,
  inheritedColor,
  scopeLabel,
  onPreview,
  onSave,
  onClose,
  onScope,
  image,
}: {
  initial: SessionMeta;
  inheritedColor: string;
  scopeLabel: string;
  onPreview: (m: SessionMeta | null) => void;
  onSave: (m: SessionMeta) => Promise<void>;
  onClose: () => void;
  onScope: () => void;
  /** התמונה של הפרויקט או האייג'נט שהסשן שייך אליו. נשמרת מיד, בנפרד מ"שמירה". */
  image?: { label: string; current?: string; emoji: string; color: string; square: boolean; onChange: (dataUrl: string) => Promise<void> };
}) {
  const [m, setM] = useState<SessionMeta>({ color: initial.color, background: initial.background, scheme: initial.scheme });
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState(image?.current ?? "");
  const [imgBusy, setImgBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const setToast = useStore((s) => s.setToast);
  const t = useT(S);
  const applyImage = async (file: File | undefined | null) => {
    if (!image || !file) return;
    if (!file.type.startsWith("image/")) return setToast(t("notImage"));
    setImgBusy(true);
    try {
      const url = await squareImage(file);
      await image.onChange(url);
      setImg(url);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setImgBusy(false);
    }
  };
  const removeImage = async () => {
    if (!image) return;
    setImgBusy(true);
    try {
      await image.onChange("");
      setImg("");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setImgBusy(false);
    }
  };
  const update = (patch: SessionMeta) => {
    const next = { ...m, ...patch };
    setM(next);
    onPreview(next);
  };
  const cancel = () => {
    onPreview(null);
    onClose();
  };
  const save = async () => {
    setBusy(true);
    try {
      await onSave(m);
      onPreview(null);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const chip = (active: boolean) => cn("size-7 rounded-full grid place-items-center transition", active ? "ring-2 ring-offset-2 ring-offset-surface ring-blue" : "hover:scale-110");
  return (
    <div className="no-drag absolute top-full mt-2 end-0 z-30 w-80 card p-3 shadow-2xl space-y-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Palette className="size-4" style={{ color: m.color ?? inheritedColor }} /> {t("sessionStyle")}
      </div>

      {image && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted">{t("imageOf", { label: image.label })}</div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void applyImage(e.dataTransfer.files?.[0]);
            }}
            className={cn("flex items-center gap-2 rounded-xl border border-dashed p-2 transition", dragOver ? "border-blue bg-blue/10" : "border-border")}
          >
            <Avatar emoji={image.emoji} color={image.color} image={img || undefined} square={image.square} size="lg" className={cn(imgBusy && "opacity-50")} />
            <div className="flex-1 min-w-0 text-[11px] text-muted leading-snug">{t("dropHint")}</div>
            <label className={cn("btn-ghost rounded-lg px-2.5 py-1 text-xs cursor-pointer shrink-0", imgBusy && "pointer-events-none opacity-50")}>
              {img ? t("replace") : t("pickImage")}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => void applyImage(e.target.files?.[0])} />
            </label>
            {img && (
              <button onClick={() => void removeImage()} disabled={imgBusy} className="text-xs text-danger hover:underline shrink-0 disabled:opacity-50">
                {t("remove")}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-xs text-muted">{t("color")}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => update({ color: undefined })} className={chip(!m.color)} title={t("inherit")}>
            <span className="size-5 rounded-full border-2 border-dashed" style={{ borderColor: inheritedColor }} />
          </button>
          {SWATCHES.map((c) => (
            <button key={c} onClick={() => update({ color: c })} className={chip(m.color?.toLowerCase() === c)} title={c}>
              <span className="size-5 rounded-full" style={{ background: c }} />
            </button>
          ))}
          <label className={cn(chip(Boolean(m.color && !SWATCHES.includes(m.color.toLowerCase()))), "relative cursor-pointer overflow-hidden")} title={t("otherColor")}>
            <span className="size-5 rounded-full" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }} />
            <input type="color" value={m.color ?? inheritedColor} onChange={(e) => update({ color: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
          </label>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs text-muted">{t("background")}</div>
        <div className="grid grid-cols-4 gap-1.5">
          <button onClick={() => update({ background: undefined })} className={cn("h-11 rounded-xl border text-[11px] text-muted", !m.background && "ring-2 ring-blue")}>
            {t("plain")}
          </button>
          {BACKGROUNDS.map((b) => (
            <button
              key={b.id}
              onClick={() => update({ background: b.id })}
              className={cn("h-11 rounded-xl border text-[11px] flex items-end justify-center pb-1", m.background === b.id && "ring-2 ring-blue")}
              style={{ background: b.css, "--agent-color": m.color ?? inheritedColor } as CSSProperties}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs text-muted">{t("scheme")}</div>
        <div className="segmented grid grid-cols-3 text-xs">
          {([
            [undefined, t("schemeApp")],
            ["light", t("light")],
            ["dark", t("dark")],
          ] as const).map(([v, label]) => (
            <button key={label} data-active={m.scheme === v} onClick={() => update({ scheme: v })} className="py-1">
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button onClick={onScope} className="text-xs text-blue hover:underline me-auto">
          {scopeLabel}
        </button>
        <button onClick={cancel} className="rounded-lg px-3 py-1 hover:bg-surface-2">
          {t("cancel")}
        </button>
        <button onClick={save} disabled={busy} className="btn-primary rounded-lg px-3 py-1 disabled:opacity-50">
          {t("save")}
        </button>
      </div>
    </div>
  );
}
