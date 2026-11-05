//! תיקיות, שקע ושפה. אותם חישובים כמו ב-desktop/main.ts וב-server/src/platform.ts: שינוי באחד מחייב את כולם.

use std::path::{Path, PathBuf};
use std::time::SystemTime;
use std::sync::Mutex;

/// תיקיית הנתונים: כמו userData של Electron (appData/מפקדה), כדי ששתי המעטפות יעבדו על אותם נתונים.
/// MIFKADA_USER_DATA לבדיקות: עותק נפרד בלי לגעת בנתונים האמיתיים.
pub fn user_data() -> PathBuf {
    if let Ok(p) = std::env::var("MIFKADA_USER_DATA") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("מפקדה")
}

/// השקע של ה-daemon: קובץ (600) בתיקיית הנתונים, וב-Windows named pipe לפי hash של התיקייה.
pub fn socket_path(data: &Path) -> String {
    #[cfg(windows)]
    {
        use sha2::{Digest, Sha256};
        let hex = Sha256::digest(data.to_string_lossy().to_lowercase().as_bytes());
        let hex: String = hex.iter().map(|b| format!("{b:02x}")).collect();
        return format!(r"\\.\pipe\mifkada-{}", &hex[..12]);
    }
    #[cfg(not(windows))]
    data.join("mifkada.sock").to_string_lossy().into_owned()
}

fn settings(data: &Path) -> serde_json::Value {
    std::fs::read_to_string(data.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null)
}

/// מאיפה רצים השרת והממשק: עדכון חם (devMode + devDir עם בנייה) או העותק שארוז עם האפליקציה.
pub struct Runtime {
    pub root: PathBuf,
    pub hot: bool,
}

pub fn runtime_root(data: &Path, bundled: Option<PathBuf>) -> Runtime {
    let st = settings(data);
    let sys = &st["system"];
    let dir = sys["devDir"].as_str().unwrap_or("");
    if !dir.is_empty() && sys["devMode"].as_bool() == Some(true) {
        let d = PathBuf::from(dir);
        if d.join("server/dist/server/src/index.js").exists() && d.join("web/dist/index.html").exists() {
            return Runtime { root: d, hot: true };
        }
    }
    // לא MIFKADA_ROOT מהסביבה: הוא דולף מסשן שרץ בתוך מפקדה (open מתוך טרמינל של סשן), ואז האפליקציה הארוזה רצה מקוד אחר
    Runtime { root: bundled.unwrap_or_else(|| PathBuf::from(".")), hot: false }
}

pub fn launch_at_login(data: &Path) -> Option<bool> {
    settings(data)["system"]["launchAtLogin"].as_bool()
}

static LANG: Mutex<Option<(Option<SystemTime>, bool)>> = Mutex::new(None);

/// עברית? system.lang מההגדרות, ובלי הגדרה לפי שפת המערכת. נקרא מחדש כשהקובץ משתנה.
pub fn is_he(data: &Path) -> bool {
    let file = data.join("settings.json");
    let mtime = std::fs::metadata(&file).and_then(|m| m.modified()).ok();
    let mut cache = LANG.lock().unwrap();
    if let Some((m, he)) = *cache {
        if m == mtime {
            return he;
        }
    }
    let set = settings(data)["system"]["lang"].as_str().map(str::to_string);
    let he = match set.as_deref() {
        Some("he") => true,
        Some("en") => false,
        _ => sys_locale::get_locale().map(|l| l.starts_with("he") || l.starts_with("iw")).unwrap_or(false),
    };
    *cache = Some((mtime, he));
    he
}

/// ה-PATH של ה-shell של המשתמש. אפליקציה שנפתחת מ-Finder מקבלת PATH מינימלי, ו-Claude Code צריך git, node וכו'.
pub fn login_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    #[cfg(windows)]
    return current;
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/bash".into() });
        let login = run_with_timeout(&shell, &["-ilc", "echo -n \"$PATH\""], 5).unwrap_or_default();
        let home = std::env::var("HOME").unwrap_or_default();
        let extra = ["/opt/homebrew/bin".to_string(), "/usr/local/bin".into(), format!("{home}/.local/bin"), format!("{home}/.local/node/bin")];
        let mut seen = std::collections::HashSet::new();
        login
            .trim()
            .split(':')
            .chain(current.split(':'))
            .chain(extra.iter().map(String::as_str))
            .filter(|p| !p.is_empty() && seen.insert(p.to_string()))
            .collect::<Vec<_>>()
            .join(":")
    }
}

#[cfg(not(windows))]
fn run_with_timeout(cmd: &str, args: &[&str], secs: u64) -> Option<String> {
    use std::process::{Command, Stdio};
    let mut child = Command::new(cmd).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let until = std::time::Instant::now() + std::time::Duration::from_secs(secs);
    loop {
        if let Ok(Some(_)) = child.try_wait() {
            let mut out = String::new();
            use std::io::Read;
            child.stdout.take()?.read_to_string(&mut out).ok()?;
            return Some(out);
        }
        if std::time::Instant::now() > until {
            let _ = child.kill();
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

/// הבינארי של Node שמריץ את ה-daemon: MIFKADA_NODE, אחר כך זה שארוז עם האפליקציה, ואחר כך node מה-PATH.
pub fn node_bin(bundled: Option<PathBuf>, path: &str) -> PathBuf {
    if let Ok(n) = std::env::var("MIFKADA_NODE") {
        if !n.is_empty() {
            return PathBuf::from(n);
        }
    }
    if let Some(b) = bundled.filter(|b| b.exists()) {
        return b;
    }
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in path.split(sep) {
        let p = Path::new(dir).join(exe);
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from(exe)
}
