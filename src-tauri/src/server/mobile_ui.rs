// src-tauri/src/server/mobile_ui.rs
// Serve the embedded mobile UI HTML to Android browsers.

use actix_web::{HttpResponse, Responder};

/// The mobile UI HTML, embedded at compile time.
const MOBILE_UI_HTML: &str = include_str!("../../mobile-ui/index.html");

/// Serve the mobile UI as the root page.
pub async fn serve_mobile_ui() -> impl Responder {
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(MOBILE_UI_HTML)
}
