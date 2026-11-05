//! WebSocket מהחלון דרך התהליך הזה (כמו preload.cjs ב-Electron): רק /ws ו-/ws/term, ורק לשרת על השקע.
//! הצד של הדף: BRIDGE_JS מגדיר window.mifkadaNet, ש-web/src/lib/socket.ts כבר יודע להשתמש בו.

use crate::net;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

pub struct Bridge {
    pub socket: String,
    /// הסוד של הערוץ המוגן: כל WebSocket שהחלון פותח מקבל אותו ככותרת
    pub secret: net::UiSecret,
    conns: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Option<String>>>>>,
}

impl Bridge {
    pub fn new(socket: String, secret: net::UiSecret) -> Self {
        Self { socket, secret, conns: Arc::new(Mutex::new(HashMap::new())) }
    }
}

#[tauri::command]
pub async fn net_open(id: String, path: String, on_event: Channel<serde_json::Value>, state: tauri::State<'_, Bridge>) -> Result<(), String> {
    if path != "/ws" && path != "/ws/term" {
        return Err("path".into());
    }
    let socket = state.socket.clone();
    let secret = state.secret.clone();
    let (tx, mut rx) = mpsc::unbounded_channel::<Option<String>>();
    state.conns.lock().unwrap().insert(id.clone(), tx);
    let conns = state.conns.clone();
    let ev = on_event.clone();
    let close = move |id: &str| {
        let _ = ev.send(serde_json::json!({ "id": id, "type": "close" }));
    };
    let ws = match net::ws(&socket, &path, Some(&secret)).await {
        Ok(ws) => ws,
        Err(_) => {
            conns.lock().unwrap().remove(&id);
            close(&id);
            return Ok(());
        }
    };
    let _ = on_event.send(serde_json::json!({ "id": id, "type": "open" }));
    let (mut sink, mut stream) = ws.split();
    let idc = id.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                out = rx.recv() => match out {
                    Some(Some(text)) => { if sink.send(Message::text(text)).await.is_err() { break; } }
                    _ => { let _ = sink.close().await; break; }
                },
                inc = stream.next() => match inc {
                    Some(Ok(Message::Text(t))) => { let _ = on_event.send(serde_json::json!({ "id": idc, "type": "message", "data": t.as_str() })); }
                    // בינארי (פלט הטרמינל): base64, והדף מפענח ל-ArrayBuffer
                    Some(Ok(Message::Binary(b))) => { let _ = on_event.send(serde_json::json!({ "id": idc, "type": "message", "bin": base64::engine::general_purpose::STANDARD.encode(&b) })); }
                    Some(Ok(_)) => {}
                    _ => break,
                },
            }
        }
        conns.lock().unwrap().remove(&idc);
        let _ = on_event.send(serde_json::json!({ "id": idc, "type": "close" }));
    });
    Ok(())
}

#[tauri::command]
pub fn net_send(id: String, data: String, state: tauri::State<'_, Bridge>) {
    if let Some(tx) = state.conns.lock().unwrap().get(&id) {
        let _ = tx.send(Some(data));
    }
}

#[tauri::command]
pub fn net_close(id: String, state: tauri::State<'_, Bridge>) {
    if let Some(tx) = state.conns.lock().unwrap().remove(&id) {
        let _ = tx.send(None);
    }
}

/// מוזרק לחלון לפני כל סקריפט של הדף. אותו ממשק כמו ה-preload של Electron.
pub const BRIDGE_JS: &str = r#"
(function () {
  if (window.mifkadaNet) return;
  var cbs = [];
  function core() { return window.__TAURI__ && window.__TAURI__.core; }
  function emit(ev) {
    if (ev.bin !== undefined) {
      var s = atob(ev.bin), a = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
      ev = { id: ev.id, type: ev.type, data: a.buffer };
    }
    for (var j = 0; j < cbs.length; j++) cbs[j](ev);
  }
  window.mifkadaNet = {
    open: function (id, path) {
      var c = core();
      var ch = new c.Channel();
      ch.onmessage = emit;
      c.invoke("net_open", { id: String(id), path: String(path), onEvent: ch }).catch(function () { emit({ id: id, type: "close" }); });
    },
    send: function (id, data) { core().invoke("net_send", { id: String(id), data: String(data) }); },
    close: function (id) { core().invoke("net_close", { id: String(id) }); },
    onEvent: function (cb) { cbs.push(cb); },
  };
  // גרירת החלון: WebKit לא מכיר -webkit-app-region, לכן אותם אזורים (.app-drag, .voice-top) מזיזים את החלון מכאן
  var DRAG = ".app-drag, .voice-top";
  var NO = "button, select, input, textarea, a, [contenteditable], .no-drag";
  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0 || !e.target.closest) return;
    var area = e.target.closest(DRAG);
    if (!area || e.target.closest(NO)) return;
    var w = window.__TAURI__ && window.__TAURI__.window && window.__TAURI__.window.getCurrentWindow();
    if (!w) return;
    if (e.detail === 2) w.toggleMaximize();
    else w.startDragging();
  });
})();
"#;
