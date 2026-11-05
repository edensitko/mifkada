//! מפקדה: המעטפת של האפליקציה ב-Tauri. מחליפה את desktop/main.ts (Electron) עם אותה התנהגות:
//! daemon על שקע מקומי עם watchdog, חלון שנטען מ-mifkada://app/ דרך השקע, WebSocket דרך גשר, התראות,
//! תג ב-Dock, מגש, ⌥⌘Space, פתיחה עם המחשב ועדכון חם. החלון הוא ה-WebView של המערכת ולא Chromium שלם.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod daemon;
mod net;
mod paths;

use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;
use tokio_tungstenite::tungstenite::Message;

/// לוג של המעטפת (main.log), לאבחון הפעלות מ-Finder שאין להן טרמינל.
pub fn mlog(data: &Path, msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(data.join("main.log")) {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{t} [tauri] {msg}");
    }
}

fn app_url() -> tauri::Url {
    // Windows ו-Android: סכמה מותאמת נחשפת כ-http://<scheme>.<host>. macOS ו-Linux: mifkada://app/
    let s = if cfg!(windows) { "http://mifkada.app/" } else { "mifkada://app/" };
    s.parse().unwrap()
}

struct Shell {
    data: PathBuf,
    quitting: Arc<AtomicBool>,
    pending: AtomicI64,
    kill_daemon: Arc<tokio::sync::Notify>,
}

impl Shell {
    fn he(&self) -> bool {
        paths::is_he(&self.data)
    }
    fn l(&self, he: &'static str, en: &'static str) -> &'static str {
        if self.he() { he } else { en }
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let sh = app.state::<Shell>();
    let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(app_url()))
        .title(sh.l("מפקדה", "Mifkada"))
        .inner_size(1440.0, 900.0)
        .min_inner_size(1000.0, 640.0)
        .background_color(tauri::window::Color(0xf2, 0xf2, 0xf7, 0xff))
        .initialization_script(bridge::BRIDGE_JS)
        .disable_drag_drop_handler()
        .visible(false);
    #[cfg(target_os = "macos")]
    {
        // בלי traffic_light_position: Tauri ממקם את הכפתורים ידנית משמאל, וכך בעברית הם לא עוברים לימין כמו במערכת
        b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    }
    let app2 = app.clone();
    b = b.on_navigation(move |url| {
        // רק המקור של מפקדה. כל השאר נפתח בדפדפן, ורק http/https
        let own = app_url();
        if url.scheme() == own.scheme() && url.host_str() == own.host_str() {
            return true;
        }
        open_outside(&app2, url.as_str());
        false
    });
    // קישור עם target=_blank / window.open: WebKit לא פותח חלון בלי טיפול, והקישור פשוט לא עשה כלום. נפתח בדפדפן
    let app3 = app.clone();
    b = b.on_new_window(move |url, _| {
        open_outside(&app3, url.as_str());
        tauri::webview::NewWindowResponse::Deny
    });
    // הורדה (<a download>, למשל ייצוא שיחה או הגדרות): לתיקיית ההורדות, בשם פנוי, והתראה בסיום
    let app4 = app.clone();
    let last: Arc<std::sync::Mutex<Option<PathBuf>>> = Arc::new(std::sync::Mutex::new(None));
    b = b.on_download(move |_w, ev| {
        match ev {
            tauri::webview::DownloadEvent::Requested { url, destination } => {
                let name = destination
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .filter(|n| !n.is_empty())
                    .or_else(|| url.path_segments().and_then(|mut s| s.next_back().map(str::to_string)))
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| "mifkada-download".into());
                let dir = dirs::download_dir().unwrap_or_else(std::env::temp_dir);
                *destination = free_path(&dir, &name);
                *last.lock().unwrap() = Some(destination.clone());
            }
            tauri::webview::DownloadEvent::Finished { success, .. } => {
                let he = paths::is_he(&app4.state::<Shell>().data);
                let saved = last.lock().unwrap().take();
                let (title, body) = match (success, saved) {
                    (true, Some(p)) => (if he { "נשמר בהורדות" } else { "Saved to Downloads" }, p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
                    _ => (if he { "ההורדה נכשלה" } else { "Download failed" }, String::new()),
                };
                notify_os(&app4, title, &body, None);
            }
            _ => {}
        }
        true
    });
    let w = b.build()?;
    let _ = w.show();
    Ok(w)
}

/// שם פנוי בתיקייה: name.ext, name (2).ext, ...
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (2..1000).map(|i| dir.join(format!("{stem} ({i}){ext}"))).find(|p| !p.exists()).unwrap_or(p)
}

fn open_outside(app: &AppHandle, target: &str) {
    use tauri_plugin_opener::OpenerExt;
    if let Ok(u) = tauri::Url::parse(target) {
        if u.scheme() == "http" || u.scheme() == "https" {
            let _ = app.opener().open_url(u.as_str(), None::<&str>);
        }
    }
}

fn show_window(app: &AppHandle, hash: Option<&str>) {
    let w = match main_window(app) {
        Some(w) => w,
        None => match create_window(app) {
            Ok(w) => w,
            Err(_) => return,
        },
    };
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    if let Some(h) = hash {
        let _ = w.eval(&format!("location.hash = {}", serde_json::to_string(h).unwrap()));
    }
}

/// עדכון חם בלי לקטוע: הממשק מחליט מתי להיטען (בלי טיוטה, בלי שיחה קולית), ואחרת מציג פס "יש גרסה חדשה".
fn notify_update(app: &AppHandle, kind: &str) {
    if let Some(w) = main_window(app) {
        let k = serde_json::to_string(kind).unwrap();
        let reload = if kind == "web" { "location.reload()" } else { "0" };
        let _ = w.eval(&format!("window.__mifkadaUpdate ? window.__mifkadaUpdate({k}) : {reload}"));
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let sh = app.state::<Shell>();
    let l = |he, en| sh.l(he, en);
    let app_menu = Submenu::with_items(
        app,
        l("מפקדה", "Mifkada"),
        true,
        &[
            &PredefinedMenuItem::about(app, Some(l("על מפקדה", "About Mifkada")), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(l("הסתר", "Hide")))?,
            &PredefinedMenuItem::quit(app, Some(l("יציאה", "Quit")))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        l("עריכה", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        l("תצוגה", "View"),
        true,
        &[
            &MenuItem::with_id(app, "reload", l("טען מחדש", "Reload"), true, Some("CmdOrCtrl+R"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    // כמו ב-VS Code: ⌘W סוגר כרטיסייה של שיחה (בממשק), ⇧⌘W סוגר (מסתיר) את החלון
    let window = Submenu::with_items(
        app,
        l("חלון", "Window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &MenuItem::with_id(app, "close-window", l("סגור חלון", "Close Window"), true, Some("CmdOrCtrl+Shift+W"))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &view, &window])
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let sh = app.state::<Shell>();
    let n = sh.pending.load(Ordering::SeqCst);
    let pending_label = if n > 0 {
        if sh.he() { format!("{n} אישורים ממתינים") } else { format!("{n} pending approvals") }
    } else {
        sh.l("אין אישורים ממתינים", "No pending approvals").to_string()
    };
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", sh.l("פתח את מפקדה", "Open Mifkada"), true, None::<&str>)?,
            &MenuItem::with_id(app, "new", sh.l("סשן חדש", "New session"), true, None::<&str>)?,
            &MenuItem::with_id(app, "inbox", pending_label, n > 0, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", sh.l("יציאה", "Quit"), true, None::<&str>)?,
        ],
    )
}

fn update_tray(app: &AppHandle) {
    let n = app.state::<Shell>().pending.load(Ordering::SeqCst);
    if let Some(t) = app.tray_by_id("main") {
        #[cfg(target_os = "macos")]
        let _ = t.set_title(if n > 0 { Some(n.to_string()) } else { None });
        if let Ok(m) = tray_menu(app) {
            let _ = t.set_menu(Some(m));
        }
    }
    if let Some(w) = main_window(app) {
        let _ = w.set_badge_count(if n > 0 { Some(n) } else { None });
    }
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => show_window(app, None),
        "new" => show_window(app, Some("#new")),
        "inbox" => show_window(app, Some("#inbox")),
        "quit" => app.exit(0),
        "reload" => {
            if let Some(w) = main_window(app) {
                let _ = w.eval("location.reload()");
            }
        }
        "close-window" => {
            if let Some(w) = main_window(app) {
                let _ = w.hide();
            }
        }
        _ => {}
    }
}

/// התראת מערכת. לחיצה עליה מביאה את החלון ופותחת את הסשן (live).
/// macOS: דרך mac-notification-sys בחוט נפרד שמחכה ללחיצה (הפלאגין של Tauri לא מדווח עליה). שאר המערכות: הפלאגין.
fn notify_os(app: &AppHandle, title: &str, body: &str, live: Option<String>) {
    #[cfg(target_os = "macos")]
    {
        let (app, title, body) = (app.clone(), title.to_string(), body.to_string());
        // בלי זה הספרייה מחפשת אפליקציה בשם "use_default" ו-macOS פותח דיאלוג "איפה נמצא use_default"
        static SET: std::sync::Once = std::sync::Once::new();
        let id = app.config().identifier.clone();
        SET.call_once(|| {
            let _ = mac_notification_sys::set_application(&id);
        });
        std::thread::spawn(move || {
            use mac_notification_sys::{Notification, NotificationResponse};
            let res = Notification::new().title(&title).message(&body).default_sound().wait_for_click(true).send();
            if let Ok(NotificationResponse::Click) = res {
                let a = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let hash = live.map(|l| format!("#live={l}"));
                    show_window(&a, hash.as_deref());
                });
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = live;
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

/// מאזין ל-daemon: מספר האישורים (תג ומגש), התראות כשהחלון לא בפוקוס, ושינוי "פתיחה עם המחשב".
async fn notifications(app: AppHandle, socket: String) {
    let sh = app.state::<Shell>();
    loop {
        if sh.quitting.load(Ordering::SeqCst) {
            return;
        }
        if let Ok(mut ws) = net::ws(&socket, "/ws", None).await {
            while let Some(Ok(msg)) = ws.next().await {
                let Message::Text(text) = msg else { continue };
                let Ok(m) = serde_json::from_str::<serde_json::Value>(text.as_str()) else { continue };
                match m["t"].as_str() {
                    Some("lives") => {
                        let n: i64 = m["lives"].as_array().map(|a| a.iter().map(|l| l["pendingPermissions"].as_i64().unwrap_or(0)).sum()).unwrap_or(0);
                        sh.pending.store(n, Ordering::SeqCst);
                        let a = app.clone();
                        let _ = app.run_on_main_thread(move || update_tray(&a));
                    }
                    Some("app") => set_login(&app, m["launchAtLogin"].as_bool().unwrap_or(false)),
                    Some("notify") => {
                        let focused = main_window(&app).map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false)).unwrap_or(false);
                        if focused && m["kind"].as_str() != Some("permission") {
                            continue;
                        }
                        let live = m["liveId"].as_str().filter(|l| !l.is_empty()).map(str::to_string);
                        notify_os(&app, m["title"].as_str().unwrap_or(""), m["body"].as_str().unwrap_or(""), live);
                    }
                    _ => {}
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn set_login(app: &AppHandle, want: bool) {
    use tauri_plugin_autostart::ManagerExt;
    if cfg!(debug_assertions) {
        return;
    }
    let al = app.autolaunch();
    // רק כשבאמת משתנה: כל רישום של LaunchAgent מקפיץ ב-macOS התראה "יישום פועל ברקע"
    if al.is_enabled().unwrap_or(false) == want {
        return;
    }
    let _ = if want { al.enable() } else { al.disable() };
}

/// עדכון חם: ממשק חדש → הודעה לממשק; שרת חדש → הריגת ה-daemon, וה-watchdog מרים אותו.
fn watch_hot(app: &AppHandle, root: &Path) {
    use notify::{RecursiveMode, Watcher};
    let web = root.join("web/dist");
    let srv = root.join("server/dist");
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<&'static str>();
    let web2 = web.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let kind = if ev.paths.iter().any(|p| p.starts_with(&web2)) { "web" } else { "server" };
            let _ = tx.send(kind);
        }
    });
    let Ok(mut watcher) = watcher else { return };
    let _ = watcher.watch(&web, RecursiveMode::Recursive);
    let _ = watcher.watch(&srv, RecursiveMode::Recursive);
    let app = app.clone();
    let index = web.join("index.html");
    tauri::async_runtime::spawn(async move {
        let _keep = watcher;
        loop {
            let Some(first) = rx.recv().await else { return };
            let mut web_changed = first == "web";
            let mut srv_changed = first == "server";
            // מחכים לשקט: vite ו-tsc כותבים הרבה קבצים בבת אחת
            while let Ok(Some(k)) = tokio::time::timeout(Duration::from_millis(900), rx.recv()).await {
                web_changed |= k == "web";
                srv_changed |= k == "server";
            }
            let sh = app.state::<Shell>();
            if srv_changed {
                mlog(&sh.data, "hot: server changed, restarting daemon");
                sh.kill_daemon.notify_one();
            } else if web_changed && index.exists() {
                mlog(&sh.data, "hot: web changed");
                let a = app.clone();
                let _ = app.run_on_main_thread(move || notify_update(&a, "web"));
            }
        }
    });
}

fn main() {
    let data = paths::user_data();
    let _ = std::fs::create_dir_all(&data);
    mlog(&data, &format!("start pid={}", std::process::id()));
    let socket = paths::socket_path(&data);
    let quitting = Arc::new(AtomicBool::new(false));
    let kill_daemon = Arc::new(tokio::sync::Notify::new());

    // סוד הערוץ המוגן לאישורי פרוד (server/src/uiTrust.ts). חי רק בזיכרון של התהליך הזה ובצינור ל-daemon
    let ui_secret = net::UiSecret::generate();
    let proxy_secret = ui_secret.clone();
    let proxy_socket = socket.clone();
    let proxy_data = data.clone();
    let mut builder = tauri::Builder::default();
    // עותק אחד בלבד (הפעלה שנייה מביאה את החלון הקיים). עותק בדיקה עם MIFKADA_USER_DATA רץ לצד האמיתי
    if std::env::var_os("MIFKADA_USER_DATA").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_window(app, None)));
    }
    builder
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(tauri_plugin_window_state::StateFlags::SIZE | tauri_plugin_window_state::StateFlags::POSITION | tauri_plugin_window_state::StateFlags::MAXIMIZED).build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["Alt+CmdOrCtrl+Space"])
                .unwrap()
                .with_handler(|app, _sc, ev| {
                    if ev.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        show_window(app, Some("#voice"));
                    }
                })
                .build(),
        )
        .manage(Shell { data: data.clone(), quitting: quitting.clone(), pending: AtomicI64::new(0), kill_daemon: kill_daemon.clone() })
        .manage(bridge::Bridge::new(socket.clone(), ui_secret.clone()))
        .invoke_handler(tauri::generate_handler![bridge::net_open, bridge::net_send, bridge::net_close])
        .register_asynchronous_uri_scheme_protocol("mifkada", move |_ctx, req, responder| {
            let socket = proxy_socket.clone();
            let secret = proxy_secret.clone();
            let he = paths::is_he(&proxy_data);
            tauri::async_runtime::spawn(async move {
                responder.respond(net::proxy(&socket, req, he, &secret).await);
            });
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            app.set_menu(build_menu(&handle)?)?;
            app.on_menu_event(|app, ev| handle_menu(app, ev.id().as_ref()));
            #[cfg(target_os = "macos")]
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/trayTemplate@2x.png"))?;
            #[cfg(not(target_os = "macos"))]
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .menu(&tray_menu(&handle)?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| handle_menu(app, ev.id().as_ref()))
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        show_window(tray.app_handle(), None);
                    }
                })
                .build(app)?;

            let path_env = paths::login_path();
            let res = app.path().resource_dir().ok();
            let rt = paths::runtime_root(&data, res.as_ref().map(|r| r.join("app")));
            let node = paths::node_bin(res.as_ref().map(|r| r.join(if cfg!(windows) { "node.exe" } else { "node" })), &path_env);
            mlog(&data, &format!("root={} hot={} node={}", rt.root.display(), rt.hot, node.display()));
            let d = Arc::new(daemon::Daemon { node, root: rt.root.clone(), data: data.clone(), socket: socket.clone(), hot: rt.hot, path_env, ui_secret: ui_secret.clone(), kill: kill_daemon.clone(), quitting: quitting.clone() });
            let h1 = handle.clone();
            let h2 = handle.clone();
            let he = paths::is_he(&data);
            tauri::async_runtime::spawn(d.run(
                Arc::new(move || {
                    let a = h1.clone();
                    let _ = h1.run_on_main_thread(move || notify_update(&a, "server"));
                }),
                Arc::new(move || {
                    let body = if he { "השרת הפנימי נופל שוב ושוב. פרטים ב-daemon.log." } else { "The internal server keeps crashing. Details in daemon.log." };
                    notify_os(&h2, if he { "מפקדה" } else { "Mifkada" }, body, None);
                }),
            ));
            if rt.hot {
                watch_hot(&handle, &rt.root);
            }
            // בבנייה של פיתוח בלבד: <נתונים>/eval.js מורץ בחלון ונמחק (לבדיקות אוטומטיות, אין DevTools פרוטוקול ב-WebKit)
            #[cfg(debug_assertions)]
            {
                let h = handle.clone();
                let f = data.join("eval.js");
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        if let Ok(js) = std::fs::read_to_string(&f) {
                            let _ = std::fs::remove_file(&f);
                            if let Some(w) = main_window(&h) {
                                let _ = w.eval(&js);
                            }
                        }
                    }
                });
            }
            let socket2 = socket.clone();
            let data2 = data.clone();
            tauri::async_runtime::spawn(async move {
                if !daemon::wait_health(&socket2, Duration::from_secs(25)).await {
                    mlog(&data2, "daemon not healthy in time");
                }
                mlog(&data2, "daemon healthy");
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    if let Err(e) = create_window(&h) {
                        mlog(&h.state::<Shell>().data, &format!("window failed: {e}"));
                    }
                });
                if let Some(want) = paths::launch_at_login(&data2) {
                    set_login(&handle, want);
                }
                notifications(handle, socket2).await;
            });
            Ok(())
        })
        .on_window_event(|w, ev| match ev {
            // ב-macOS סגירת החלון רק מסתירה אותו: האפליקציה והסשנים נשארים. יציאה אמיתית ב-⌘Q
            WindowEvent::CloseRequested { api, .. } => {
                let sh = w.app_handle().state::<Shell>();
                if cfg!(target_os = "macos") && !sh.quitting.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("tauri build")
        .run(move |app, ev| match ev {
            RunEvent::ExitRequested { .. } => {
                let sh = app.state::<Shell>();
                if !sh.quitting.swap(true, Ordering::SeqCst) {
                    mlog(&sh.data, "quit");
                    sh.kill_daemon.notify_one();
                    // שנייה לסגירה מסודרת של ה-daemon (הוא סוגר את הסשנים החיים)
                    std::thread::sleep(Duration::from_millis(600));
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_window(app, None),
            _ => {}
        });
}
