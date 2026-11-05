/**
 * diff שורות קטן לתצוגה בצ'אט: רק מה שהשתנה, עם כמה שורות הקשר מסביב.
 * Edit של Claude שולח קטע קצר, אבל ספקים אחרים (Codex דרך ACP) שולחים את כל הקובץ לפני ואחרי, ובלי diff אמיתי
 * כל הקובץ היה מוצג כמחוק ונוסף.
 */
export type DiffRow = { sign: " " | "-" | "+" | "…"; text: string };

/** מעל זה (שורות באמצע, אחרי הורדת ההתחלה והסוף המשותפים) אין LCS: מוחק ומוסיף, כמו קודם */
const LCS_LIMIT = 600;

export function lineDiff(oldText: string, newText: string, context = 2): DiffRow[] {
  const a = oldText ? oldText.split("\n") : [];
  const b = newText.split("\n");
  // התחלה וסוף משותפים
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);

  const mid: DiffRow[] = [];
  if (am.length * bm.length > LCS_LIMIT * LCS_LIMIT || am.length > LCS_LIMIT * 4 || bm.length > LCS_LIMIT * 4) {
    for (const l of am) mid.push({ sign: "-", text: l });
    for (const l of bm) mid.push({ sign: "+", text: l });
  } else {
    // LCS קלאסי מהסוף, ואז הליכה קדימה
    const n = am.length;
    const m = bm.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    // בתיקו: קודם המחיקה ואז ההוספה, כמו ב-git diff
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) {
        mid.push({ sign: " ", text: am[i] });
        i++;
        j++;
      } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) mid.push({ sign: "-", text: am[i++] });
      else mid.push({ sign: "+", text: bm[j++] });
    }
  }

  const all: DiffRow[] = [...a.slice(0, pre).map((text) => ({ sign: " " as const, text })), ...mid, ...a.slice(a.length - suf).map((text) => ({ sign: " " as const, text }))];
  // רק שורות שהשתנו ו-context שורות סביבן. פער באמצע = "…"
  const keep = all.map(() => false);
  all.forEach((r, k) => {
    if (r.sign === " ") return;
    for (let x = Math.max(0, k - context); x <= Math.min(all.length - 1, k + context); x++) keep[x] = true;
  });
  const out: DiffRow[] = [];
  let gap = false;
  all.forEach((r, k) => {
    if (keep[k]) {
      if (gap && out.length) out.push({ sign: "…", text: "" });
      gap = false;
      out.push(r);
    } else gap = true;
  });
  return out;
}
