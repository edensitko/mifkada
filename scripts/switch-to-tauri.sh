#!/bin/zsh
# מעבר מ-Electron ל-Tauri (או חזרה עם --back). להריץ מטרמינל רגיל, לא מתוך סשן של מפקדה:
# סגירת האפליקציה סוגרת את הסשנים החיים שלה (אפשר להמשיך אותם אחר כך מהרשימה).
set -e
REPO=${MIFKADA_REPO:-$HOME/projects/mifkada}
ELECTRON="/Applications/Mifkada.app"
TAURI="/Applications/Mifkada (Tauri).app"

wait_gone() {
  for i in {1..40}; do pgrep -f "$1/Contents/MacOS/" >/dev/null || return 0; sleep 0.5; done
  echo "האפליקציה לא נסגרה: $1"; exit 1
}

if [[ "$1" == "--back" ]]; then
  osascript -e 'tell application id "dev.mifkada.app" to quit' 2>/dev/null || true
  wait_gone "$TAURI"
  open "$ELECTRON"
  echo "חזרת ל-Electron."
  exit 0
fi

[[ -d "$TAURI" ]] || { echo "חסר $TAURI"; exit 1; }
echo "סוגר את מפקדה (Electron)..."
osascript -e "tell application \"$ELECTRON\" to quit" 2>/dev/null || true
wait_gone "$ELECTRON"
echo "בונה שרת וממשק ב-$REPO..."
(cd "$REPO" && npm run build -w server >/dev/null && npm run build -w web >/dev/null)
open "$TAURI"
echo "מפקדה רצה עכשיו על Tauri. חזרה: $0 --back"
