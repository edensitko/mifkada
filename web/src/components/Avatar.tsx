import { cn } from "../lib/util";

/** אווטאר בסגנון אייקון של אפליקציה: ריבוע מעוגל לפרויקט, עיגול לאייג'נט, צבע מלא עם אות או אימוג'י. */
export default function Avatar({ emoji, color, image, size = "md", className, square }: { emoji: string; color: string; image?: string; size?: "sm" | "md" | "lg" | "xl"; className?: string; square?: boolean }) {
  const dims = { sm: "size-6 text-[11px]", md: "size-8 text-sm", lg: "size-11 text-lg", xl: "size-16 text-2xl" }[size];
  if (image)
    return <img src={image} alt="" draggable={false} className={cn("inline-block shrink-0 object-cover", square ? "rounded-[26%]" : "rounded-full", dims, className)} style={{ boxShadow: "0 1px 2px rgba(0,0,0,.12)" }} />;
  const isLetter = [...emoji].length === 1 && /[\p{L}\p{N}]/u.test(emoji);
  return (
    <span
      className={cn("inline-grid place-items-center shrink-0 font-semibold text-white", square ? "rounded-[26%]" : "rounded-full", dims, className)}
      style={{
        background: `linear-gradient(160deg, ${color}, color-mix(in oklab, ${color} 78%, black))`,
        boxShadow: "0 1px 2px rgba(0,0,0,.12)",
        textShadow: isLetter ? "0 1px 1px rgba(0,0,0,.15)" : undefined,
      }}
    >
      {emoji}
    </span>
  );
}
