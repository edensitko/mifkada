# CLAUDE.md - מפקדה (Mifkada)

מרכז שליטה מקומי לסשני Claude Code, בעברית ו-RTL. אפליקציית Electron שמריצה daemon של Node על ה-Claude Agent SDK
הרשמי. הממשק בעברית; קוד, נתיבים ופקודות נשארים LTR.

## מבנה

```
shared/protocol.ts   החוזה בין השרת לממשק (טיפוסים בלבד, מיובא משני הצדדים)
server/src/          daemon ב-Node 24 + TypeScript: Hono (REST) + ws (WebSocket) + Agent SDK
  index.ts           נקודת הכניסה, כל ה-REST, הגשת web/dist
  live.ts            LiveSession: סשן SDK אחד במצב streaming input, אירועים ובקשות הרשאה
  ws.ts              Hub: הסשנים החיים, הלקוחות, פרוטוקול ה-WebSocket
  history.ts         קריאת תמליל מהדיסק ונרמול לבלוקים
  external.ts        סשנים שרצים מחוץ למפקדה (~/.claude/sessions/<pid>.json)
  tasks.ts, worktree.ts, routines.ts    קנבן, ענף נפרד למשימה, רוטינות
  activity.ts        מי עוד עובד באותו ריפו (לבידוד משימות ולאזהרה בסשן חדש)
  settings.ts, roots.ts                 הגדרות המערכת ותיקיות הפרויקטים
  map.ts             הגרף של המפה ורשימת "מה חסר"
  origin.ts          הגנות Host / Origin / טוקן (ראו SECURITY.md)
web/src/             Vite + React 19 + Tailwind v4 + zustand
  store.ts           המצב; ws.ts לקוח WebSocket; api.ts כל קריאות ה-REST
  components/        Sidebar, ChatView, Blocks, Composer, Board, Workspace, MapView, Onboarding...
  lib/               לוגיקה טהורה עם בדיקות (transcript, split, slashOptions, util)
desktop/             Electron: main.ts מריץ את ה-daemon (utilityProcess) ופותח חלון; preload.cjs; after-pack.cjs (fuses)
bin/                 mifkada-task.mjs (CLI למשימות, דרך קובץ השקע), mifkada-git-guard.mjs (hook של Claude Code)
```

## הרצה

```bash
npm run dev          # daemon (tsx watch) + Vite על 4778 + חלון Electron
npm run typecheck    # tsc בשלושת החלקים
npm test             # server/test + web/test (node:test + tsx)
npm run app          # בנייה ואריזה ל-release/mac-arm64/Mifkada.app (חתימה אד-הוק)
npm run install:app  # אריזה, העתקה ל-/Applications והפעלה
```

- **באפליקציה הארוזה** ה-daemon מאזין על קובץ שקע (`MIFKADA_SOCKET`, הרשאות 600), לא על פורט. החלון נטען מ-`mifkada://app/`
  ו-`protocol.handle` מעביר כל בקשה לשקע; WebSocket עובר דרך `preload.cjs` ו-`ipcMain`. בלי `MIFKADA_SOCKET` (פיתוח,
  בדיקות) השרת על `127.0.0.1:4777`.
- **תיקיית הנתונים:** `~/Library/Application Support/מפקדה` (או `MIFKADA_DATA`): tasks, themes, settings, summaries, גיבויים, לוגים.
- **עדכון חם:** `devMode` + `devDir` בהגדרות טוענים את ה-daemon ואת `web/dist` מתיקיית הקוד. `npm run hot` בונה web ושרת.
  בניית שרת מפעילה מחדש את ה-daemon וסוגרת את הסשנים החיים (אפשר להמשיך אותם מהרשימה).

## איך זה עובד

- **זהות:** כל תהליך של Claude Code מקבל env דרך `applyClaudeAuth` (claudeAuth.ts): מפתח API כברירת מחדל, ראו למטה.
- **סשן חי** נפתח בהודעה הראשונה ונשאר פתוח במצב streaming input. `resume` ממשיך סשן קיים; סשן שרץ בטרמינל נפתח כ-fork.
- **אישורים:** `canUseTool` של ה-SDK הופך לכרטיס בממשק. נקרא רק כשכללי ההרשאות של Claude Code לא הכריעו.
  `bypassPermissions` חסום בשרת בכל מסלול (`safeMode` ב-live.ts) אלא אם `system.allowBypass` הוגדר ידנית.
- **אייג'נט של סשן** = `tag` של הסשן (`tagSession`). אייג'נטים הם קבצים ב-`~/.claude/agents/*.md`.
- **פרויקט של סשן** = `meta.project` ב-themes.json אם הוגדר, אחרת ה-cwd. תיקיות הפרויקטים (`projectRoots`) מהגדרות.
- **רשימת הסשנים:** `listSessions()` של ה-SDK ממוזג עם `~/.claude/sessions` (חיים מבחוץ) ועם ה-Hub. הממשק מרענן כל 4 שניות.
- **ענף נפרד למשימה:** worktree ב-`<ריפו>/../.mifkada-worktrees/<repo>-<id>` על ענף `mifkada/<slug>-<id>`. מיזוג = `merge --no-ff`
  לענף הבסיס. משימה חדשה עוברת לענף נפרד לבד אם `activeInRepo` מוצא סשן חי באותו שורש git.
- **עוזרי רקע** (`system.aiHelpers`, כבוי כברירת מחדל): תקציר "מאז אתמול" ושיוך סשנים לפרויקט קוראים למודל. לא לקרוא
  למודל ברקע בלי ההגדרה הזו.

## עיצוב ושפה

- שפת העיצוב: Apple. הכול ב-`web/src/index.css`: בהיר כברירת מחדל, כהה לפי המערכת, צבעי iOS, גופן המערכת, `.card` עם צל דק.
- ערכת צבעים לסשן בודד דרך `[data-scheme]` שמגדיר מחדש את משתני הצבע על הקונטיינר.
- **כיוון טקסט:** הממשק `dir="rtl"`. טקסט חופשי (תשובות, בועות, כותרות) מקבל `dir="auto"` לכל פסקה. שדות קלט משתמשים ב-
  `unicode-bidi: plaintext` (לא `dir="auto"`, אחרת placeholder עברי קופץ שמאלה). קוד ונתיבים תמיד `.ltr`.
- טקסט בממשק: עברית, מקף רגיל `-` ולא `—`. תוויות מודלים הן כינויים (`opus`, `sonnet`, `haiku`), בלי מספרי גרסה.

## מלכודות ידועות

- **`ELECTRON_RUN_AS_NODE=1`** עובר בסביבה מתוך Claude Code ו-VS Code והופך את Electron ל-Node בלי חלון. הסקריפטים
  מריצים עם `env -u ELECTRON_RUN_AS_NODE`; באפליקציה הארוזה ה-fuse כבוי וה-daemon רץ ב-`utilityProcess.fork`.
- **שרת בדיקה מתוך סשן שרץ במפקדה:** תמיד `env -u MIFKADA_SOCKET`, אחרת הוא יורש את השקע של האפליקציה. השרת מסרב
  למחוק שקע שמישהו עונה בו, אבל עדיף לא להגיע לשם.
- **בדיקת ממשק בדפדפן מתוך סשן:** שרת על פורט אחר עם `MIFKADA_DATA` זמני ו-`MIFKADA_ROOT` לתיקייה שבה נבנה web, ו-Playwright
  עם `routeWebSocket(/\/ws/)` חסום. בלי זה, לחיצה על סשן פותחת אותו כחי מול ה-`~/.claude` האמיתי.
- **תיקיות מוגנות של macOS** (הורדות, iCloud) חוסמות `readdir` עד אישור פרטיות ותופסות חוט של libuv. `isProtectedDir()`
  מדלג עליהן בסריקות רקע.
- `CFBundleName` חייב להיות באנגלית (Electron גוזר ממנו את שם ה-Helper apps). רק `CFBundleDisplayName` בעברית.
- אחרי אריזה חובה חתימה אד-הוק (`codesign --force --deep --sign -`), אחרת LaunchServices מסרב להפעיל בשקט.
- `node-pty`: ה-postinstall לא תמיד רץ ו-`spawn-helper` נשאר בלי `+x`; `terminal.ts` מתקן בזמן ריצה.
- שני `WebSocketServer` על אותו שרת חייבים `noServer` ו-dispatch ידני ב-`upgrade`.
- `vite build` עם `emptyOutDir=false` ו-`scripts/prune-dist.mjs`, כדי שחלון שנטען באמצע בנייה לא יקבל 404.
- `tagSession` ו-resume כותבים לקובץ הסשן ומקפיצים אותו בראש הרשימה; שומרים ומחזירים את ה-mtime (`fs.utimes`).
- `enableRemoteControl` של ה-SDK קיים ב-runtime אבל לא בטיפוסים (cast). דורש `keepSessionOnExit: true`.

## כללים

- לוגיקה טהורה ב-`web/src/lib` עם בדיקה ב-`web/test`; לוגיקת שרת עם בדיקה ב-`server/test` (ריפו ותיקיית נתונים זמניים).
- כל שינוי ב-`activity.ts` צריך שינוי מקביל ב-`bin/mifkada-git-guard.mjs` (אותה לוגיקה, בלי תלויות).
- לא להעתיק קוד מפרויקטים ברישיון copyleft.

## התחברות ושומר פרוד (11/2026)

- **התחברות:** `server/src/claudeAuth.ts`. ברירת המחדל `system.authMode = "apiKey"`: הסשנים רצים על מפתח API של Anthropic
  (`anthropicKey` ב-settings.json במצב 600, או `ANTHROPIC_API_KEY`), או Bedrock/Vertex מהסביבה. כל תהליך של Claude Code
  (live, summary, digest, autotag, commands, extensions, auth) מקבל env דרך `applyClaudeAuth`. `claudeCode` = ההתחברות
  של Claude Code במחשב, רק בעריכה ידנית. הסיבה: לפי התנאים של ה-Agent SDK מוצר של צד שלישי לא מציע התחברות עם claude.ai.
- **שומר הפרוד:** `prodGuard.ts → prodHosts()` = `system.prodHosts` + `MIFKADA_PROD_HOSTS`. בלי hosts, ssh/scp/rsync לא
  נבדקים. הבדיקות מגדירות hosts מדומים ב-`server/test/setup.ts`.
