import { useStore } from "../store";
import { send } from "../ws";
import { confirmMode, modelLabel, MODE_OPTIONS } from "./util";
import type { PermissionMode } from "../../../shared/protocol";
import { strings, tr } from "../i18n";

const S = strings({
  he: {
    pickModel: "בחר מודל בסרגל למעלה, או כתוב /model opus",
    modelSet: "המודל הוחלף ל-{model}",
    pickMode: "כתוב /mode ובחר מהרשימה: שואל, מאשר עריכות, תכנון...",
    modeSet: "מצב ההרשאות: {mode}",
  },
  en: {
    pickModel: "Pick a model in the bar above, or type /model opus",
    modelSet: "Model switched to {model}",
    pickMode: "Type /mode and pick from the list: Ask, Accept edits, Plan...",
    modeSet: "Permission mode: {mode}",
  },
});

interface Ctx {
  cwd: string;
  agent: string | null;
  liveId?: string;
  setModel: (m: string | null) => void;
  setMode: (m: PermissionMode) => void;
  toast: (t: string) => void;
}

/** פקודות / שיש להן מקבילה בממשק של מפקדה. מחזיר true אם טופלה (ואז לא נשלחת ל-Claude) */
export function runUiCommand(name: string, args: string, ctx: Ctx): boolean {
  const st = useStore.getState();
  switch (name) {
    case "clear":
      st.select({ kind: "new", cwd: ctx.cwd, agent: ctx.agent });
      return true;
    case "model": {
      if (!args) {
        ctx.toast(tr(S, "pickModel"));
        return true;
      }
      if (ctx.liveId) send({ t: "set_model", liveId: ctx.liveId, model: args });
      else ctx.setModel(args);
      ctx.toast(tr(S, "modelSet", { model: modelLabel(args) }));
      return true;
    }
    case "mode": {
      const opt = MODE_OPTIONS.find((o) => o.value === args && o.value !== "bypassPermissions");
      if (!opt) {
        ctx.toast(tr(S, "pickMode"));
        return true;
      }
      void confirmMode(opt.value).then((ok) => {
        if (!ok) return;
        if (ctx.liveId) send({ t: "set_mode", liveId: ctx.liveId, mode: opt.value });
        else ctx.setMode(opt.value);
        ctx.toast(tr(S, "modeSet", { mode: opt.label }));
      });
      return true;
    }
    case "resume":
      st.setPalette(true);
      return true;
    case "agents":
      st.select({ kind: "agents" });
      return true;
    case "config":
    case "permissions":
      st.select({ kind: "settings" });
      if (name === "permissions") setTimeout(() => document.getElementById("safety")?.scrollIntoView({ behavior: "smooth" }), 150);
      return true;
    default:
      return false;
  }
}
