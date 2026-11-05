/**
 * חוליות ה-breadcrumb של בורר התיקיות: הבית (~) ואז כל תיקייה בדרך. נתיב מחוץ לבית (לא אמור לקרות, השרת חוסם)
 * מתחיל משורש הדיסק. פונקציה טהורה, נבדקת ב-web/test/ui-logic.test.ts.
 */
export function crumbs(p: string, home: string): Array<{ name: string; path: string }> {
  const sep = p.includes("\\") && !p.includes("/") ? "\\" : "/";
  const trim = (x: string) => (x.length > 1 && x.endsWith(sep) ? x.slice(0, -1) : x);
  const full = trim(p);
  const h = trim(home);
  const under = full === h || full.startsWith(h + sep);
  const base = under ? h : full.startsWith(sep) ? sep : full.split(sep)[0];
  const out = [{ name: under ? "~" : base, path: base }];
  let acc = base;
  for (const part of full.slice(base.length).split(sep).filter(Boolean)) {
    acc = acc.endsWith(sep) ? acc + part : acc + sep + part;
    out.push({ name: part, path: acc });
  }
  return out;
}
