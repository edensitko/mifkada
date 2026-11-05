import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { applyPrefs } from "./lib/prefs";

applyPrefs();
import App from "./App";
import { applyLang, lang } from "./i18n";
applyLang(lang());

// חלון שלא בפוקוס (עובדים באפליקציה אחרת): אנימציות הסטטוס נעצרות, כדי שכרטיס המסך לא יצייר 120 פריימים בשנייה בשביל ספינר
const syncFocus = () => document.documentElement.toggleAttribute("data-blurred", !document.hasFocus());
window.addEventListener("focus", syncFocus);
window.addEventListener("blur", syncFocus);
syncFocus();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
