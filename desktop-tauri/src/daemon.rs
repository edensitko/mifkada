//! ה-daemon של מפקדה (server/dist) רץ ב-Node כתהליך ילד, עם watchdog: נפל שלא ביציאה → עולה מחדש תוך שנייה.
//! עד 5 נפילות בדקה, אחר כך התראה ועצירה (כמו scheduleRestart ב-desktop/main.ts).

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::sync::Notify;

pub struct Daemon {
    pub node: PathBuf,
    pub root: PathBuf,
    pub data: PathBuf,
    pub socket: String,
    pub hot: bool,
    pub path_env: String,
    /// סוד הערוץ המוגן. נכתב ל-stdin בכל עלייה (גם אחרי watchdog), לא בסביבה: תהליכי claude יורשים סביבה, לא את הצינור
    pub ui_secret: crate::net::UiSecret,
    /// הורג את התהליך הנוכחי (עדכון חם של השרת, יציאה). ה-watchdog מרים אותו מחדש אם לא יוצאים
    pub kill: Arc<Notify>,
    pub quitting: Arc<AtomicBool>,
}

impl Daemon {
    fn spawn(&self) -> std::io::Result<tokio::process::Child> {
        let log = std::fs::OpenOptions::new().create(true).append(true).open(self.data.join("daemon.log"))?;
        let script = self.root.join("server/dist/server/src/index.js");
        let mut cmd = tokio::process::Command::new(&self.node);
        // משתני MIFKADA_* שדלפו מהסביבה (הפעלה מתוך סשן של מפקדה) לא עוברים לשרת. רק מה שנקבע כאן
        for (k, _) in std::env::vars_os() {
            if k.to_string_lossy().starts_with("MIFKADA_") {
                cmd.env_remove(&k);
            }
        }
        cmd.arg(script)
            .current_dir(&self.root)
            .env("PATH", &self.path_env)
            .env("MIFKADA_PORT", "4777")
            .env("MIFKADA_SOCKET", &self.socket)
            .env("MIFKADA_ROOT", &self.root)
            .env("MIFKADA_DATA", &self.data)
            .env("MIFKADA_HOT", if self.hot { "1" } else { "0" })
            .env_remove("ELECTRON_RUN_AS_NODE")
            // צינור שנשאר פתוח כל עוד המעטפת חיה: כשהיא מתה (גם kill -9) השרת רואה סוף קלט ויוצא
            .env("MIFKADA_PARENT_STDIN", "1")
            .env("MIFKADA_UI_SECRET_STDIN", "1")
            .stdin(Stdio::piped())
            .stdout(log.try_clone()?)
            .stderr(log)
            .kill_on_drop(true);
        cmd.spawn()
    }

    /// מריץ את ה-daemon ומחזיק אותו חי. on_restart נקרא אחרי עלייה מחדש (רענון הממשק), on_giveup אחרי 5 נפילות בדקה.
    pub async fn run(self: Arc<Self>, on_restart: Arc<dyn Fn() + Send + Sync>, on_giveup: Arc<dyn Fn() + Send + Sync>) {
        let mut restarts: Vec<Instant> = Vec::new();
        let mut first = true;
        loop {
            let mut child = match self.spawn() {
                Ok(c) => c,
                Err(e) => {
                    crate::mlog(&self.data, &format!("daemon spawn failed: {e}"));
                    on_giveup();
                    return;
                }
            };
            crate::mlog(&self.data, &format!("daemon spawned pid={:?}", child.id()));
            // wait() של tokio סוגר את stdin לפני ההמתנה, והשרת היה רואה סוף קלט ויוצא. מחזיקים אותו כאן
            let mut stdin = child.stdin.take();
            if let Some(w) = stdin.as_mut() {
                let line = self.ui_secret.stdin_line();
                if w.write_all(line.as_bytes()).await.is_err() || w.flush().await.is_err() {
                    crate::mlog(&self.data, "ui secret: write to daemon stdin failed");
                }
            }
            let _stdin = stdin;
            if !first {
                // עלה מחדש: כשהוא בריא, הממשק מתעדכן (בלי לחסום את ההמתנה ליציאה שלו)
                let me = self.clone();
                let cb = on_restart.clone();
                tokio::spawn(async move {
                    if wait_health(&me.socket, Duration::from_secs(25)).await {
                        crate::mlog(&me.data, "daemon restarted");
                        cb();
                    }
                });
            }
            first = false;
            tokio::select! {
                status = child.wait() => {
                    crate::mlog(&self.data, &format!("daemon exited {status:?}"));
                }
                _ = self.kill.notified() => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                }
            }
            if self.quitting.load(Ordering::SeqCst) {
                return;
            }
            let now = Instant::now();
            restarts.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
            if restarts.len() >= 5 {
                crate::mlog(&self.data, "daemon crashed 5 times in a minute, giving up");
                on_giveup();
                return;
            }
            restarts.push(now);
            tokio::time::sleep(Duration::from_millis(800)).await;
        }
    }
}

pub async fn wait_health(socket: &str, timeout: Duration) -> bool {
    let until = Instant::now() + timeout;
    while Instant::now() < until {
        if crate::net::health(socket).await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    false
}
