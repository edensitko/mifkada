/**
 * חסימת git שמשנה היסטוריה או מפרסם, בסשנים של משימות מהקנבן (31/10: משימה עם "אסור commit" בפרומפט עשתה
 * commit ו-merge ל-main). הוראה בפרומפט לא עוצרת סוכן, לכן LiveSession מריץ את זה כ-hook מסוג PreToolUse.
 *
 * הניתוח הוא tokenizer קטן של shell ולא regex על הטקסט: שרשור (&& ; | ||), תת-פקודות ($(...), `...`, <(...)),
 * sh/bash/zsh -c, eval, env וכל עוטף נפוץ (command, exec, sudo, nohup, timeout, xargs...), אפשרויות גלובליות
 * של git (-C, -c, --git-dir) ו-alias (מוגדר ב-gitconfig או ב-`-c alias.x=...`).
 * לא מכסה: סקריפט שנכתב לקובץ ואז רץ (bash x.sh, node x.js). זו שכבה אחת, לא ארגז חול.
 */

export interface GitBlock {
  /** הפעולה, לתצוגה: "commit", "push", "reset --hard", "branch -D"... */
  op: string;
}

type Words = string[];

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const RESERVED = new Set(["if", "then", "else", "elif", "do", "while", "until", "fi", "done", "!", "{", "}", "time"]);
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** פיצול טקסט של shell לפקודות פשוטות (מערך מילים לכל אחת). מקורות מקוננים ($(...), `...`) נאספים ל-nested. */
export function splitShell(src: string): { commands: Words[]; nested: string[] } {
  const commands: Words[] = [];
  const nested: string[] = [];
  let words: Words = [];
  let word = "";
  let inWord = false;
  let dropNext = false; // המילה הבאה היא יעד של הפניה (> file)
  const heredocs: string[] = [];
  let i = 0;

  const endWord = () => {
    if (inWord) {
      if (dropNext) dropNext = false;
      else words.push(word);
    }
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  // תוכן מאוזן עד הסוגר המתאים, תוך כיבוד מרכאות
  const balanced = (start: number): number => {
    let depth = 1;
    let j = start;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === "\\") j++;
      else if (ch === "'") j = src.indexOf("'", j + 1) === -1 ? src.length : src.indexOf("'", j + 1);
      else if (ch === '"') {
        j++;
        while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      } else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      j++;
    }
    return j;
  };
  const substitution = (): boolean => {
    if (src[i] === "$" && src[i + 1] === "(") {
      const end = balanced(i + 2);
      nested.push(src.slice(i + 2, end - 1));
      word += "$()";
      inWord = true;
      i = end;
      return true;
    }
    if (src[i] === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== "`") j += src[j] === "\\" ? 2 : 1;
      nested.push(src.slice(i + 1, j));
      word += "$()";
      inWord = true;
      i = j + 1;
      return true;
    }
    return false;
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n") {
      endCommand();
      i++;
      // גוף של heredoc הוא נתונים, לא פקודות
      for (const delim of heredocs.splice(0)) {
        for (;;) {
          const nl = src.indexOf("\n", i);
          const line = src.slice(i, nl === -1 ? src.length : nl);
          i = nl === -1 ? src.length : nl + 1;
          if (line.replace(/^\t+/, "") === delim || nl === -1) break;
        }
      }
      continue;
    }
    if (ch === " " || ch === "\t") {
      endWord();
      i++;
      continue;
    }
    if (ch === "#" && !inWord) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "\\") {
      if (src[i + 1] !== "\n") word += src[i + 1] ?? "";
      inWord = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      word += src.slice(i + 1, end === -1 ? src.length : end);
      inWord = true;
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (ch === '"') {
      inWord = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && /["\\$`\n]/.test(src[i + 1] ?? "")) {
          word += src[i + 1];
          i += 2;
        } else if (!substitution()) word += src[i++];
      }
      i++;
      continue;
    }
    if (substitution()) continue;
    if ((ch === "<" || ch === ">") && src[i + 1] === "(") {
      const end = balanced(i + 2);
      nested.push(src.slice(i + 2, end - 1));
      i = end;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "&" || ch === "(" || ch === ")") {
      // &> ו->& הם הפניות, לא מפרידים
      if (ch === "&" && src[i + 1] === ">") {
        endWord();
        i += src[i + 2] === ">" ? 3 : 2;
        dropNext = true;
        continue;
      }
      endCommand();
      i++;
      continue;
    }
    if (ch === "<" || ch === ">") {
      // מספר מתאר צמוד (2>) הוא חלק מההפניה
      if (inWord && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      } else endWord();
      if (src.startsWith("<<<", i)) i += 3;
      else if (src.startsWith("<<", i)) {
        i += src[i + 2] === "-" ? 3 : 2;
        while (src[i] === " ") i++;
        const m = /^(["']?)([^\s"';|&<>()]+)\1/.exec(src.slice(i));
        if (m) {
          heredocs.push(m[2]);
          i += m[0].length;
        }
        continue;
      } else {
        i++;
        if (src[i] === ">" || src[i] === "&" || src[i] === "|") i++;
      }
      // >&2: היעד הוא מספר מתאר
      const fd = /^\d+-?/.exec(src.slice(i));
      if (src[i - 1] === "&" && fd) i += fd[0].length;
      else dropNext = true;
      continue;
    }
    word += ch;
    inWord = true;
    i++;
  }
  endCommand();
  return { commands, nested };
}

const basename = (w: string) => w.slice(w.lastIndexOf("/") + 1);
const has = (args: Words, ...flags: string[]) => args.some((a) => flags.includes(a.split("=")[0]));
const shortHas = (args: Words, letters: string) => args.some((a) => /^-[a-zA-Z]+$/.test(a) && [...letters].some((l) => a.includes(l)));

/** האם פקודת git (אחרי האפשרויות הגלובליות) משנה היסטוריה או מפרסמת. */
function gitRule(sub: string, args: Words): string | null {
  const abort = has(args, "--abort", "--quit", "--show-current-patch");
  switch (sub) {
    case "commit":
    case "push":
    case "pull":
    case "filter-branch":
    case "filter-repo":
    case "update-ref":
    case "send-pack":
    case "http-push":
      return sub;
    case "merge":
    case "rebase":
    case "cherry-pick":
    case "revert":
    case "am":
      return abort ? null : sub;
    case "reset": {
      const f = args.find((a) => ["--hard", "--keep", "--merge", "--soft"].includes(a));
      return f ? `reset ${f}` : null;
    }
    case "branch":
      if (shortHas(args, "DMf") || has(args, "--force")) return "branch -D";
      if (has(args, "--delete", "-d") && has(args, "--force")) return "branch -D";
      if (has(args, "-m", "--move")) return "branch -m";
      return null;
    case "tag": {
      const mutate = args.some((a) => /^-[a-zA-Z]*[dasufmF]/.test(a) && !a.startsWith("--")) || has(args, "--delete", "--annotate", "--sign", "--local-user", "--force", "--message", "--file", "--create-reflog");
      if (mutate) return "tag";
      const positional = args.some((a) => !a.startsWith("-"));
      const listing = has(args, "-l", "--list", "--contains", "--no-contains", "--points-at", "--merged", "--no-merged") || args.some((a) => /^-n\d*$/.test(a));
      return positional && !listing ? "tag" : null;
    }
    case "worktree":
      return ["remove", "prune", "move"].includes(args[0] ?? "") ? `worktree ${args[0]}` : null;
    case "reflog":
      return ["expire", "delete"].includes(args[0] ?? "") ? `reflog ${args[0]}` : null;
    case "replace":
      return args.length && !has(args, "-l", "--list") ? "replace" : null;
    case "config":
      // alias חדש הוא דרך לקרוא ל-commit בשם אחר
      return args.some((a) => /^alias\./.test(a)) && !has(args, "--get", "--get-all", "--get-regexp", "-l", "--list") ? "config alias" : null;
    default:
      return null;
  }
}

const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--list-cmds"]);

function analyzeGit(rest: Words, aliases: Record<string, string>, depth: number): GitBlock | null {
  const local = { ...aliases };
  let i = 0;
  while (i < rest.length && rest[i].startsWith("-")) {
    const a = rest[i];
    if (a === "--config-env" || a.startsWith("--config-env=")) {
      const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : (rest[i + 1] ?? "");
      if (/^alias\./i.test(v)) return { op: "alias" };
    }
    if (a === "-c") {
      const m = /^alias\.([^=]+)=(.*)$/is.exec(rest[i + 1] ?? "");
      if (m) local[m[1].toLowerCase()] = m[2];
    }
    i += GIT_VALUE_OPTS.has(a) ? 2 : 1;
  }
  let sub = rest[i];
  let args = rest.slice(i + 1);
  if (!sub) return null;
  // alias: הרחבה עד 5 רמות. "!..." הוא פקודת shell
  for (let n = 0; n < 5 && local[sub.toLowerCase()] !== undefined; n++) {
    const exp = local[sub.toLowerCase()].trim();
    if (exp.startsWith("!")) return analyzeShell(`${exp.slice(1)} ${args.join(" ")}`, aliases, depth + 1);
    const parts = splitShell(exp).commands[0] ?? [];
    if (!parts.length) return null;
    sub = parts[0];
    args = [...parts.slice(1), ...args];
  }
  const op = gitRule(sub, args);
  return op ? { op } : null;
}

function ghRule(args: Words): string | null {
  const [group, action] = args;
  if (group === "pr" && ["create", "merge"].includes(action)) return `gh pr ${action}`;
  if (group === "release" && ["create", "delete", "upload", "edit"].includes(action)) return `gh release ${action}`;
  if (group === "repo" && ["create", "delete", "sync", "rename", "archive"].includes(action)) return `gh repo ${action}`;
  if (group === "api") {
    const mi = args.findIndex((a) => a === "-X" || a === "--method");
    const method = (mi >= 0 ? args[mi + 1] : args.find((a) => /^(-X|--method=)/.test(a))?.replace(/^(-X|--method=)/, "")) ?? "";
    if (method && method.toUpperCase() !== "GET") return "gh api";
    if (!method && has(args, "-f", "-F", "--field", "--raw-field", "--input")) return "gh api";
  }
  return null;
}

/** עוטפים שמריצים את שאר הפקודה: כמה מילים לדלג לפני הפקודה עצמה. */
function skipWrapper(w: Words, i: number): number | null {
  const base = basename(w[i]);
  const opts = (j: number, withValue: string[]) => {
    while (j < w.length && w[j].startsWith("-") && w[j] !== "-") {
      if (w[j] === "--") return j + 1;
      j += withValue.includes(w[j]) ? 2 : 1;
    }
    return j;
  };
  switch (base) {
    case "command":
    case "builtin":
    case "nohup":
    case "noglob":
    case "nocorrect":
    case "caffeinate":
    case "stdbuf":
    case "arch":
      return opts(i + 1, ["-t", "-w"]);
    case "exec":
      return opts(i + 1, ["-a"]);
    case "time":
      return opts(i + 1, []);
    case "sudo":
    case "doas":
      return opts(i + 1, ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U"]);
    case "nice":
      return opts(i + 1, ["-n"]);
    case "timeout":
    case "gtimeout": {
      const j = opts(i + 1, ["-s", "-k", "--signal", "--kill-after"]);
      return j + 1; // משך הזמן
    }
    case "xargs":
      return opts(i + 1, ["-I", "-L", "-n", "-P", "-s", "-E", "-d", "-a", "-J", "-R"]);
    case "watch":
      return opts(i + 1, ["-n", "--interval", "-d"]);
    default:
      return null;
  }
}

function analyzeCommand(w: Words, aliases: Record<string, string>, depth: number): GitBlock | null {
  let i = 0;
  for (let guard = 0; guard < 20 && i < w.length; guard++) {
    if (RESERVED.has(w[i]) || ASSIGN.test(w[i])) {
      i++;
      continue;
    }
    const base = basename(w[i]);
    if (base === "env") {
      i++;
      while (i < w.length) {
        const a = w[i];
        if (a === "-S" || a === "--split-string") return analyzeShell(w.slice(i + 1).join(" "), aliases, depth + 1);
        if (a.startsWith("-S") && a.length > 2) return analyzeShell([a.slice(2), ...w.slice(i + 1)].join(" "), aliases, depth + 1);
        if (a === "-u" || a === "-C" || a === "-P" || a === "--unset" || a === "--chdir") i += 2;
        else if (a.startsWith("-") || ASSIGN.test(a)) i++;
        else break;
      }
      continue;
    }
    const next = skipWrapper(w, i);
    if (next !== null) {
      i = next;
      continue;
    }
    break;
  }
  if (i >= w.length) return null;
  const prog = w[i];
  const base = basename(prog);
  const rest = w.slice(i + 1);
  if (SHELLS.has(base)) {
    // -c, -lc, -ec...: המילה הבאה אחרי האפשרויות היא הסקריפט
    const ci = rest.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    if (ci >= 0) {
      const script = rest.slice(ci + 1).find((a) => !a.startsWith("-"));
      return script ? analyzeShell(script, aliases, depth + 1) : null;
    }
    return null;
  }
  if (base === "eval") return analyzeShell(rest.join(" "), aliases, depth + 1);
  if (base === "git") return analyzeGit(rest, aliases, depth);
  if (base === "gh") {
    const op = ghRule(rest);
    return op ? { op } : null;
  }
  // $GIT commit או $(which git) push: אי אפשר לדעת מה התוכנית, אז בודקים כאילו זה git
  if (prog.startsWith("$")) return analyzeGit(rest, aliases, depth);
  return null;
}

/**
 * הפעולה החסומה הראשונה בטקסט של פקודת shell, או null אם אין.
 * aliases: alias של git מה-gitconfig (שם → הרחבה).
 */
export function analyzeShell(src: string, aliases: Record<string, string> = {}, depth = 0): GitBlock | null {
  if (depth > 8) return { op: "פקודה מקוננת מדי" };
  // דרכים לעקוף דרך מפקדה עצמה: היתר git למשימה, או מיזוג הענף דרך ה-API
  if (/mifkada-task[^\n]*--allow-git|\/api\/tasks\b[^\n]*\ballowGit\b|\ballowGit\b[^\n]*\/api\/tasks\b/.test(src)) return { op: "היתר git למשימה" };
  if (/\/api\/tasks\/[^\s"'/]+\/merge\b/.test(src)) return { op: "מיזוג משימה דרך ה-API" };
  const { commands, nested } = splitShell(src);
  for (const w of commands) {
    const hit = analyzeCommand(w, aliases, depth);
    if (hit) return hit;
  }
  for (const n of nested) {
    const hit = analyzeShell(n, aliases, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** ההודעה ש-Claude מקבל כשפקודה נחסמת. */
export function gitBlockMessage(op: string): string {
  return (
    `${op} דורש אישור של המשתמש: סמן במשימה "מותר commit" (או --allow-git ב-mifkada-task). ` +
    `בסשן של משימה מהקנבן אסור commit, merge, rebase, push, reset --hard, branch -D, tag ו-worktree remove. ` +
    `השאר את השינויים בתיקייה בלי commit: המשתמש ימזג מהקנבן. אל תנסה לעקוף (sh -c, git -C, alias, סקריפט), זה נחסם גם כן.`
  );
}
