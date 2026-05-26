use actix_cors::Cors;
use actix_web::{
    web, App, HttpServer,
};
use std::sync::Arc;

use crate::state::AppState;
use crate::error::AppError;

pub mod mobile_ui;
pub mod routes;
pub mod streaming;
pub mod websocket;

pub struct ServerState {
    pub app_state: Arc<parking_lot::RwLock<AppState>>,
    pub tauri_app: tauri::AppHandle,
}

pub fn start_server(
    app_state: Arc<parking_lot::RwLock<AppState>>,
    app_handle: tauri::AppHandle,
    port: u16,
) -> Result<actix_web::dev::ServerHandle, AppError> {
    let server_state = web::Data::new(ServerState {
        app_state: app_state.clone(),
        tauri_app: app_handle.clone(),
    });

    let server = HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .app_data(server_state.clone())
            // WebSocket route
            .route("/ws", web::get().to(websocket::ws_handler))
            // API Routes
            .route("/api/status", web::get().to(routes::get_status))
            .route("/api/files", web::get().to(routes::list_files))
            .route("/api/download/{id}", web::get().to(routes::download_file))
            .route("/download/{id}/{name}", web::get().to(routes::download_file_with_name))
            .route("/download-all", web::get().to(routes::download_all))
            .route("/api/download-all", web::get().to(routes::download_all))
            // UI Route (catch all, serves mobile UI)
            .route("/", web::get().to(mobile_ui::serve_mobile_ui))
    })
    .bind(("0.0.0.0", port))
    .map_err(AppError::Io)?
    .disable_signals() // Tauri handles signals
    .workers(4)
    .run();

    let server_handle = server.handle();
    
    // Spawn server in a separate thread because Actix uses its own Tokio runtime
    std::thread::spawn(move || {
        let sys = actix_web::rt::System::new();
        let _ = sys.block_on(server);
    });

    Ok(server_handle)
}
