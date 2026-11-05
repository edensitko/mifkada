import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Copy } from "lucide-react";
import { strings, tr } from "../i18n";

const S = strings({
  he: {
    log: "מפקדה: קומפוננטה נפלה",
    title: "משהו נשבר במסך הזה",
    body: "שאר מפקדה ממשיכה לעבוד. אפשר לנסות שוב, ואם זה חוזר, להעתיק את השגיאה ל-Claude.",
    retry: "נסה שוב",
    copy: "העתק שגיאה",
  },
  en: {
    log: "Mifkada: a component crashed",
    title: "Something broke on this screen",
    body: "The rest of Mifkada keeps working. You can try again, and if it happens again, copy the error to Claude.",
    retry: "Try again",
    copy: "Copy error",
  },
});

/**
 * רשת ביטחון: קומפוננטה שנופלת מציגה כרטיס שגיאה במקום שכל החלון יהפוך ללבן.
 * עוטפת את התוכן הראשי ואת כל חלון במסך המחולק בנפרד, כך שחלון אחד שנשבר לא מפיל את האחרים.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; label?: string; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(tr(S, "log"), error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // מעבר למסך אחר מנקה את השגיאה
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex-1 grid place-items-center p-6">
        <div className="card p-6 max-w-md text-center space-y-3">
          <span className="ios-icon mx-auto !size-12 !rounded-2xl" style={{ background: "#ff453a" }}>
            <AlertTriangle className="!size-6" />
          </span>
          <h3 className="font-semibold text-[17px]">{this.props.label ?? tr(S, "title")}</h3>
          <p className="text-sm text-muted">{tr(S, "body")}</p>
          <pre dir="ltr" className="text-[11px] mono text-start bg-[var(--color-fill)] rounded-lg p-2 max-h-28 overflow-auto whitespace-pre-wrap">{error.message}</pre>
          <div className="flex gap-2 justify-center">
            <button onClick={() => this.setState({ error: null })} className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5">
              <RotateCcw className="size-4" /> {tr(S, "retry")}
            </button>
            <button onClick={() => void navigator.clipboard.writeText(`${error.message}\n${error.stack ?? ""}`)} className="btn-ghost px-4 py-1.5 text-sm flex items-center gap-1.5">
              <Copy className="size-4" /> {tr(S, "copy")}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
