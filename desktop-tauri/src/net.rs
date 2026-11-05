//! חיבור ל-daemon על השקע המקומי: בקשות HTTP של החלון (mifkada://app/...) ו-WebSocket.
//! בלי פורט ברשת: שום דף בדפדפן לא מגיע לשרת, רק התהליך הזה.

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper_util::rt::TokioIo;
use std::pin::Pin;
use tokio::io::{AsyncRead, AsyncWrite};

pub trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}
pub type Stream = Pin<Box<dyn Io>>;

/// כותרת הערוץ המוגן (server/src/uiTrust.ts): רק בקשות שיוצאות מהחלון מקבלות אותה
pub const UI_HEADER: &str = "x-mifkada-ui";

/// סוד הערוץ המוגן: 32 בתים אקראיים כ-hex, חדש בכל הפעלה. עובר ל-daemon ב-stdin (daemon.rs) ומצורף לבקשות של החלון.
/// בלי Debug ובלי Display, כדי שלא ייכנס בטעות ללוג.
#[derive(Clone)]
pub struct UiSecret(std::sync::Arc<str>);

impl UiSecret {
    pub fn generate() -> Self {
        let mut b = [0u8; 32];
        getrandom::fill(&mut b).expect("getrandom");
        Self(b.iter().map(|x| format!("{x:02x}")).collect::<String>().into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// השורה שהשרת מחכה לה ב-stdin (readSecretFrom ב-uiTrust.ts)
    pub fn stdin_line(&self) -> String {
        format!("ui-secret {}\n", self.0)
    }
}

pub async fn connect(socket: &str) -> std::io::Result<Stream> {
    #[cfg(unix)]
    {
        let s = tokio::net::UnixStream::connect(socket).await?;
        Ok(Box::pin(s))
    }
    #[cfg(windows)]
    {
        let s = tokio::net::windows::named_pipe::ClientOptions::new().open(socket)?;
        Ok(Box::pin(s))
    }
}

/// בקשה אחת ל-daemon. מחזיר סטטוס, כותרות וגוף מלא.
pub async fn request(socket: &str, req: hyper::Request<Full<Bytes>>) -> Result<hyper::Response<Bytes>, String> {
    let stream = connect(socket).await.map_err(|e| e.to_string())?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.map_err(|e| e.to_string())?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let res = sender.send_request(req).await.map_err(|e| e.to_string())?;
    let (parts, body) = res.into_parts();
    let body = body.collect().await.map_err(|e| e.to_string())?.to_bytes();
    Ok(hyper::Response::from_parts(parts, body))
}

pub async fn health(socket: &str) -> bool {
    let req = hyper::Request::get("/api/health").header("host", "localhost").body(Full::new(Bytes::new())).unwrap();
    matches!(tokio::time::timeout(std::time::Duration::from_secs(3), request(socket, req)).await, Ok(Ok(r)) if r.status() == 200)
}

/// CSP של השרת מתיר רק 'self'. ה-IPC של Tauri (הגשר ל-WebSocket) עובר ב-ipc: / http://ipc.localhost, לכן מוסיפים רק אותם
fn patch_csp(v: &str) -> String {
    v.split(';')
        .map(|d| {
            let t = d.trim();
            if t.starts_with("connect-src") { format!("{t} ipc: http://ipc.localhost") } else { t.to_string() }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// הבקשה ל-daemon מתוך בקשה של החלון: בלי Origin, בלי עוגיות ובלי sec-fetch (השקע עצמו הוא ההגנה, כמו ב-Electron),
/// ועם כותרת הערוץ המוגן. כותרת כזו שהדף שלח בעצמו לא עוברת.
pub fn upstream_request(req: tauri::http::Request<Vec<u8>>, secret: &UiSecret) -> Result<hyper::Request<Full<Bytes>>, String> {
    let uri = req.uri();
    let path = uri.path_and_query().map(|p| p.as_str().to_string()).unwrap_or_else(|| "/".into());
    let mut b = hyper::Request::builder().method(req.method().as_str()).uri(path).header("host", "localhost");
    for (k, v) in req.headers() {
        let n = k.as_str().to_ascii_lowercase();
        if n == "origin" || n == "cookie" || n == "host" || n == "referer" || n.starts_with("sec-fetch-") || n == "content-length" || n == UI_HEADER {
            continue;
        }
        b = b.header(k.as_str(), v.as_bytes());
    }
    b = b.header(UI_HEADER, secret.as_str());
    let body = req.into_body();
    if !body.is_empty() {
        b = b.header("content-length", body.len());
    }
    b.body(Full::new(Bytes::from(body))).map_err(|e| e.to_string())
}

/// בקשה מהחלון עוברת ל-daemon
pub async fn proxy(socket: &str, req: tauri::http::Request<Vec<u8>>, he: bool, secret: &UiSecret) -> tauri::http::Response<Vec<u8>> {
    let out = match upstream_request(req, secret) {
        Ok(r) => request(socket, r).await,
        Err(e) => Err(e),
    };
    match out {
        Ok(res) => {
            let mut rb = tauri::http::Response::builder().status(res.status().as_u16());
            for (k, v) in res.headers() {
                let n = k.as_str();
                if n.eq_ignore_ascii_case("set-cookie") || n.eq_ignore_ascii_case("transfer-encoding") || n.eq_ignore_ascii_case("connection") {
                    continue;
                }
                if n.eq_ignore_ascii_case("content-security-policy") {
                    rb = rb.header(n, patch_csp(v.to_str().unwrap_or("")));
                    continue;
                }
                rb = rb.header(n, v.as_bytes());
            }
            rb.body(res.into_body().to_vec()).unwrap_or_else(|_| bad(he))
        }
        Err(_) => bad(he),
    }
}

fn bad(he: bool) -> tauri::http::Response<Vec<u8>> {
    let msg = if he { "השרת של מפקדה לא זמין כרגע" } else { "Mifkada's server isn't available right now" };
    tauri::http::Response::builder()
        .status(502)
        .header("content-type", "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

pub type Ws = tokio_tungstenite::WebSocketStream<Stream>;

/// בקשת ה-upgrade: Host: localhost (השרת בודק אותו), בלי Origin. עם סוד = חיבור של החלון (גשר ה-WebSocket).
pub fn ws_request(path: &str, secret: Option<&UiSecret>) -> Result<tokio_tungstenite::tungstenite::handshake::client::Request, String> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut req = format!("ws://localhost{path}").into_client_request().map_err(|e| e.to_string())?;
    if let Some(s) = secret {
        req.headers_mut().insert(UI_HEADER, s.as_str().parse().map_err(|_| "header".to_string())?);
    }
    Ok(req)
}

/// WebSocket ל-daemon על השקע. secret רק לחיבורים של החלון; ההתראות של המעטפת לא צריכות אותו.
pub async fn ws(socket: &str, path: &str, secret: Option<&UiSecret>) -> Result<Ws, String> {
    let req = ws_request(path, secret)?;
    let stream = connect(socket).await.map_err(|e| e.to_string())?;
    let (ws, _) = tokio_tungstenite::client_async(req, stream).await.map_err(|e| e.to_string())?;
    Ok(ws)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_is_64_hex_and_fresh() {
        let a = UiSecret::generate();
        let b = UiSecret::generate();
        assert_eq!(a.as_str().len(), 64);
        assert!(a.as_str().chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
        assert_ne!(a.as_str(), b.as_str());
        assert_eq!(a.stdin_line(), format!("ui-secret {}\n", a.as_str()));
    }

    #[test]
    fn proxy_adds_secret_and_drops_page_header() {
        let s = UiSecret::generate();
        let req = tauri::http::Request::builder()
            .method("POST")
            .uri("mifkada://app/api/x?y=1")
            .header("origin", "mifkada://app")
            .header("cookie", "a=b")
            .header(UI_HEADER, "ff".repeat(32))
            .header("content-type", "application/json")
            .body(b"{}".to_vec())
            .unwrap();
        let out = upstream_request(req, &s).unwrap();
        assert_eq!(out.uri(), "/api/x?y=1");
        let vals: Vec<_> = out.headers().get_all(UI_HEADER).iter().collect();
        assert_eq!(vals.len(), 1);
        assert_eq!(vals[0], s.as_str());
        assert!(out.headers().get("origin").is_none());
        assert!(out.headers().get("cookie").is_none());
        assert_eq!(out.headers()["content-length"], "2");
        assert_eq!(out.headers()["host"], "localhost");
    }

    #[test]
    fn ws_header_only_with_secret() {
        let s = UiSecret::generate();
        let r = ws_request("/ws", Some(&s)).unwrap();
        assert_eq!(r.headers()[UI_HEADER], s.as_str());
        assert!(ws_request("/ws", None).unwrap().headers().get(UI_HEADER).is_none());
    }
}
