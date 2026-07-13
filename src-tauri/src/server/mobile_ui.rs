


use actix_web::{HttpResponse, Responder};


const MOBILE_UI_HTML: &str = include_str!("../../mobile-ui/index.html");


pub async fn serve_mobile_ui() -> impl Responder {
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(MOBILE_UI_HTML)
}
