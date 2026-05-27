#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

pub mod config;
pub mod error;
pub mod network;
pub mod qr;
pub mod security;
pub mod server;
pub mod state;

use std::sync::Arc;
use parking_lot::RwLock;
use tauri::Manager;
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::Emitter;
use state::{AppState, SharedFileInfo};
use error::AppError;

// Tauri Commands

#[tauri::command]
async fn get_server_status(state: tauri::State<'_, Arc<RwLock<AppState>>>) -> Result<serde_json::Value, AppError> {
    let app_state = state.read();
    let local_ips = network::discovery::get_all_local_ips();
    Ok(serde_json::json!({
        "serverRunning": app_state.server_running,
        "port": app_state.server_port,
        "accessUrl": app_state.server_url,
        "activeConnections": app_state.ws_client_count,
        "localIps": local_ips
    }))
}

#[tauri::command]
async fn start_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<String, AppError> {
    let mut app_state = state.write();
    if app_state.server_running {
        return Ok(app_state.server_url.clone().unwrap_or_default());
    }

    let port = app_state.config.port;
    
    // Refresh IPs
    let ips = network::discovery::get_all_local_ips();
    app_state.local_ip = ips.first().cloned();
    
    // Start Actix server
    match server::start_server(state.inner().clone(), app.clone(), port) {
        Ok(handle) => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            
            // Spawn a task inside Tauri's tokio runtime to wait for stop signal
            let handle_clone = handle.clone();
            tauri::async_runtime::spawn(async move {
                let _ = rx.await;
                handle_clone.stop(true).await;
            });

            app_state.server_stop_tx = Some(tx);
            app_state.server_running = true;
            app_state.server_port = port;
            
            // Set access URL
            let ip = app_state.local_ip.clone().unwrap_or_else(|| "127.0.0.1".into());
            let url = format!("http://{}:{}", ip, port);
            app_state.server_url = Some(url.clone());
            
            let _ = app.emit("server-started", serde_json::json!({ "url": url }));
            Ok(url)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
async fn stop_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<(), AppError> {
    let mut app_state = state.write();
    if let Some(tx) = app_state.server_stop_tx.take() {
        let _ = tx.send(());
    }
    app_state.server_running = false;
    app_state.server_url = None;
    let _ = app.emit("server-stopped", ());
    Ok(())
}

#[tauri::command]
async fn add_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<Vec<SharedFileInfo>, AppError> {
    let mut app_state = state.write();
    let mut added = Vec::new();

    for path_str in paths {
        let path = std::path::PathBuf::from(path_str);
        if path.exists() {
            if let Ok(info) = app_state.add_file(path) {
                added.push(info);
            }
        }
    }
    let _ = app.emit("files-changed", ());
    Ok(added)
}

#[tauri::command]
async fn add_folder(
    app: tauri::AppHandle,
    path: String,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<Vec<SharedFileInfo>, AppError> {
    let mut app_state = state.write();
    let mut added = Vec::new();
    let path_buf = std::path::PathBuf::from(path);
    if path_buf.exists() {
        if let Ok(info) = app_state.add_file(path_buf) {
            added.push(info);
        }
    }
    let _ = app.emit("files-changed", ());
    Ok(added)
}

#[tauri::command]
async fn remove_file(
    app: tauri::AppHandle,
    id: String,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<(), AppError> {
    let mut app_state = state.write();
    app_state.remove_file(&id).map_err(AppError::File)?;
    let _ = app.emit("files-changed", ());
    Ok(())
}

#[tauri::command]
async fn clear_files(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<(), AppError> {
    let mut app_state = state.write();
    app_state.clear_files();
    let _ = app.emit("files-changed", ());
    Ok(())
}

#[tauri::command]
async fn get_shared_files(state: tauri::State<'_, Arc<RwLock<AppState>>>) -> Result<Vec<SharedFileInfo>, AppError> {
    Ok(state.read().get_files_ordered())
}

#[tauri::command]
async fn get_qr_code(
    url: Option<String>,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<String, AppError> {
    let url = match url {
        Some(u) => u,
        None => state.read().server_url.clone().ok_or_else(|| AppError::Server("No QR code available".into()))?,
    };
    qr::generate_qr_data_uri(&url).map_err(|e| AppError::Qr(e.to_string()))
}

#[tauri::command]
async fn get_local_ips() -> Result<Vec<String>, AppError> {
    Ok(network::discovery::get_all_local_ips())
}

#[tauri::command]
async fn get_transfer_log(
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<Vec<state::TransferRecord>, AppError> {
    let app_state = state.read();
    Ok(app_state.transfer_log.clone())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendAppConfig {
    pub port: u16,
    pub password: Option<String>,
    pub auto_start: bool,
    pub show_notifications: bool,
}

#[tauri::command]
async fn get_config(
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<FrontendAppConfig, AppError> {
    let app_state = state.read();
    let config = &app_state.config;
    Ok(FrontendAppConfig {
        port: config.port,
        password: if config.require_pin { config.pin_code.clone() } else { None },
        auto_start: config.auto_start_server,
        show_notifications: config.notify_on_download,
    })
}

#[tauri::command]
async fn update_config(
    app: tauri::AppHandle,
    config: FrontendAppConfig,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<(), AppError> {
    let mut app_state = state.write();
    
    let require_pin = config.password.as_ref().map(|p| !p.trim().is_empty()).unwrap_or(false);
    let pin_code = if require_pin { config.password.clone() } else { None };
    
    let new_config = config::AppConfig {
        port: config.port,
        auto_start_server: config.auto_start,
        notify_on_download: config.show_notifications,
        require_pin,
        pin_code,
        ..app_state.config.clone()
    };
    
    new_config.validate().map_err(AppError::Config)?;
    
    // Ensure Firewall Rule for the new port on Windows!
    #[cfg(target_os = "windows")]
    {
        let _ = network::firewall::ensure_firewall_rule(config.port);
    }
    
    // Save to disk (we use . as config_dir which maps to AppState config_dir)
    let config_dir = app_state.config_dir.clone();
    new_config.save(&config_dir).map_err(AppError::Config)?;
    
    let port_changed = config.port != app_state.config.port;
    let was_running = app_state.server_running;
    
    if was_running && port_changed {
        // Stop active server first
        if let Some(tx) = app_state.server_stop_tx.take() {
            let _ = tx.send(());
        }
        app_state.server_running = false;
        app_state.server_url = None;
        let _ = app.emit("server-stopped", ());
    }
    
    app_state.config = new_config;
    
    if was_running && port_changed {
        // Start Actix server on new port
        let app_handle = app.clone();
        match server::start_server(state.inner().clone(), app_handle.clone(), config.port) {
            Ok(handle) => {
                let (tx, rx) = tokio::sync::oneshot::channel();
                tauri::async_runtime::spawn(async move {
                    let _ = rx.await;
                    handle.stop(true).await;
                });

                app_state.server_stop_tx = Some(tx);
                app_state.server_running = true;
                app_state.server_port = config.port;
                
                let ip = app_state.local_ip.clone().unwrap_or_else(|| "127.0.0.1".into());
                let url = format!("http://{}:{}", ip, config.port);
                app_state.server_url = Some(url.clone());
                
                let _ = app_handle.emit("server-started", serde_json::json!({ "url": url }));
            }
            Err(e) => {
                let _ = app_handle.emit("server-stopped", ());
                return Err(e);
            }
        }
    }
    
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = config::AppConfig::default();
    let config_dir = std::path::PathBuf::from(".");
    let app_state = Arc::new(RwLock::new(AppState::new(config, config_dir)));
    let app_state_clone = app_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .setup(move |app| {
            // Resolve the standard Tauri config directory for robustness!
            let config_dir = app.path().app_config_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            let loaded_config = config::AppConfig::load(&config_dir);
            
            {
                let mut state = app_state_clone.write();
                state.config_dir = config_dir;
                state.config = loaded_config;
            }

            // Check for firewall rule (Windows) using the dynamically configured port!
            #[cfg(target_os = "windows")]
            {
                let port = app_state_clone.read().config.port;
                let _ = network::firewall::ensure_firewall_rule(port);
            }

            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Shairee")
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_server_status,
            start_server,
            stop_server,
            add_files,
            add_folder,
            remove_file,
            clear_files,
            get_shared_files,
            get_qr_code,
            get_local_ips,
            get_transfer_log,
            get_config,
            update_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
