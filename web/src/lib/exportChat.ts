import type { TranscriptMessage } from "../../../shared/protocol";
import { dateLocale } from "./util";
import { pick } from "../i18n";

/** ייצוא שיחה לקובץ Markdown: הטקסט שלך ושל Claude, וכל כלי בשורה אחת */
export function exportChatMarkdown(title: string, project: string, messages: TranscriptMessage[]): void {
  const lines: string[] = [`# ${title}`, "", `${project} · ${new Date().toLocaleString(dateLocale())}`, ""];
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.type === "text" && b.text.trim()) lines.push(m.role === "user" ? `**${pick("אני", "Me")}:** ${b.text}` : `**Claude:** ${b.text}`, "");
      else if (b.type === "tool_use") {
        const d = (b.input as { description?: string } | undefined)?.description;
        lines.push(`> 🔧 ${b.name}${d ? `: ${d}` : ""}`, "");
      }
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "session"}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
