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
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
    let bind_address = app_state.config.bind_address.clone();
    let manual_ip = app_state.config.manual_ip.clone();
    let auto_detect_ip = app_state.config.auto_detect_ip;

    // Resolve display IP: manual override or auto-detect
    if let Some(ref manual) = manual_ip {
        app_state.local_ip = Some(manual.clone());
    } else if auto_detect_ip {
        let ips = network::discovery::get_all_local_ips();
        app_state.local_ip = ips.first().cloned();
    }

    // Read broadcast data before releasing the lock
    let device_name = app_state.config.server_name.clone();
    let require_pin = app_state.config.require_pin;

    // Start Actix server
    match server::start_server(state.inner().clone(), app.clone(), port, &bind_address) {
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

            // Proactively broadcast presence so receivers already scanning can find us
            network::discovery::broadcast_presence(&device_name, port, require_pin);

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

#[cfg(target_os = "android")]
fn copy_content_uri_to_cache(app: &tauri::AppHandle, uri: &str) -> Result<String, String> {
    use tauri::Manager;
    let window = app.get_webview_window("main")
        .ok_or_else(|| "Failed to get main window".to_string())?;
    
    let (tx, rx) = std::sync::mpsc::channel();
    let uri_str = uri.to_string();
    
    window.with_webview(move |webview| {
        webview.jni_handle().exec(move |env, context, _webview| {
            let res = (|| -> Result<String, String> {
                let uri_jstring = env.new_string(&uri_str)
                    .map_err(|e| format!("JNI error creating string: {:?}", e))?;
                
                let result_jvalue = env.call_method(
                    context,
                    "copyContentUriToCache",
                    "(Ljava/lang/String;)Ljava/lang/String;",
                    &[jni::objects::JValue::from(&uri_jstring)]
                ).map_err(|e| format!("JNI call failed: {:?}", e))?;

                let result_jobject = result_jvalue.l()
                    .map_err(|e| format!("JNI result was not an object: {:?}", e))?;
                
                let result_jstring: &jni::objects::JString = (&result_jobject).into();
                
                let result_str: String = env.get_string(result_jstring)
                    .map_err(|e| format!("JNI string conversion failed: {:?}", e))?
                    .into();
                
                Ok(result_str)
            })();
            let _ = tx.send(res);
        });
    }).map_err(|e| e.to_string())?;
    
    rx.recv()
        .map_err(|e| format!("JNI thread disconnected: {}", e))?
}

#[tauri::command]
async fn add_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
    state: tauri::State<'_, Arc<RwLock<AppState>>>,
) -> Result<Vec<SharedFileInfo>, AppError> {
    println!("add_files called with paths: {:?}", paths);
    let mut app_state = state.write();
    let mut added = Vec::new();

    for path_str in paths {
        let resolved_path = if path_str.starts_with("content://") {
            #[cfg(target_os = "android")]
            {
                println!("Resolving content URI: {}", path_str);
                match copy_content_uri_to_cache(&app, &path_str) {
                    Ok(p) => {
                        println!("Resolved to: {}", p);
                        p
                    },
                    Err(e) => {
                        println!("Failed to resolve content URI {}: {:?}", path_str, e);
                        continue;
                    }
                }
            }
            #[cfg(not(target_os = "android"))]
            path_str
        } else {
            path_str
        };

        let path = std::path::PathBuf::from(&resolved_path);
        println!("Checking if path exists: {:?}", path);
        if path.exists() {
            match app_state.add_file(path) {
                Ok(info) => {
                    println!("Added file: {:?}", info);
                    added.push(info);
                },
                Err(e) => {
                    println!("Failed to add file {:?}: {:?}", resolved_path, e);
                }
            }
        } else {
            println!("Path does not exist: {:?}", resolved_path);
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
    println!("add_folder called with path: {:?}", path);
    let mut app_state = state.write();
    let mut added = Vec::new();
    let path_buf = std::path::PathBuf::from(&path);
    println!("Checking if folder exists: {:?}", path_buf);
    if path_buf.exists() {
        match app_state.add_file(path_buf) {
            Ok(info) => {
                println!("Added folder: {:?}", info);
                added.push(info);
            },
            Err(e) => {
                println!("Failed to add folder {:?}: {:?}", path, e);
            }
        }
    } else {
        println!("Folder path does not exist: {:?}", path);
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
    pub username: String,
    pub bind_address: String,
    pub manual_ip: Option<String>,
    pub auto_detect_ip: bool,
    pub max_concurrent_downloads: u32,
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
        username: config.server_name.clone(),
        bind_address: config.bind_address.clone(),
        manual_ip: config.manual_ip.clone(),
        auto_detect_ip: config.auto_detect_ip,
        max_concurrent_downloads: config.max_concurrent_downloads,
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
        server_name: config.username.clone(),
        bind_address: config.bind_address.clone(),
        manual_ip: config.manual_ip,
        auto_detect_ip: config.auto_detect_ip,
        max_concurrent_downloads: config.max_concurrent_downloads,
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
        match server::start_server(state.inner().clone(), app_handle.clone(), config.port, &config.bind_address) {
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

#[tauri::command]
async fn discover_devices() -> Result<Vec<serde_json::Value>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let local_ips = network::discovery::get_all_local_ips();
        let mut sockets = Vec::new();

        for ip in &local_ips {
            if let Ok(addr) = format!("{}:0", ip).parse::<std::net::SocketAddr>() {
                if let Ok(socket) = std::net::UdpSocket::bind(addr) {
                    let _ = socket.set_broadcast(true);
                    let _ = socket.set_nonblocking(true);
                    
                    // Send to general broadcast
                    let _ = socket.send_to(b"SHAIREE_DISCOVER", "255.255.255.255:8389");
                    
                    // Send to class C subnet broadcast
                    if let std::net::IpAddr::V4(ipv4) = addr.ip() {
                        let octets = ipv4.octets();
                        let subnet_bcast = format!("{}.{}.{}.255:8389", octets[0], octets[1], octets[2]);
                        let _ = socket.send_to(b"SHAIREE_DISCOVER", &subnet_bcast);
                    }
                    sockets.push(socket);
                }
            }
        }

        // Fallback to binding 0.0.0.0 if no specific interfaces bound successfully
        if sockets.is_empty() {
            if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
                let _ = socket.set_broadcast(true);
                let _ = socket.set_nonblocking(true);
                let _ = socket.send_to(b"SHAIREE_DISCOVER", "255.255.255.255:8389");
                sockets.push(socket);
            }
        }

        let mut groups: std::collections::HashMap<(String, u16, bool), Vec<String>> = std::collections::HashMap::new();
        let mut buf = [0u8; 1024];

        let start = std::time::Instant::now();
        while start.elapsed() < std::time::Duration::from_millis(1500) {
            for socket in &sockets {
                match socket.recv_from(&mut buf) {
                    Ok((amt, src)) => {
                        let msg = String::from_utf8_lossy(&buf[..amt]);
                        if msg.starts_with("SHAIREE_SERVER|") {
                            let parts: Vec<&str> = msg.split('|').collect();
                            if parts.len() >= 4 {
                                let name = parts[1].to_string();
                                let port_str = parts[2];
                                let require_pin_str = parts[3];
                                
                                let ip = src.ip().to_string();
                                let port = port_str.parse::<u16>().unwrap_or(8384);
                                let require_pin = require_pin_str == "true";

                                let key = (name, port, require_pin);
                                let ips = groups.entry(key).or_insert_with(Vec::new);
                                if !ips.contains(&ip) {
                                    ips.push(ip);
                                }
                            }
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // No data yet on this interface
                    }
                    Err(_) => {}
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        let mut devices = Vec::new();
        for ((name, port, require_pin), ips) in groups {
            devices.push(serde_json::json!({
                "name": name,
                "ips": ips,
                "port": port,
                "requirePin": require_pin
            }));
        }

        Ok(devices)
    }).await.map_err(|e| AppError::Server(format!("Task error: {e}")))?
}

#[tauri::command]
async fn respond_to_receive_request(
    sender_ip: String,
    accept: bool,
    state: tauri::State<'_, Arc<parking_lot::RwLock<AppState>>>,
) -> Result<(), AppError> {
    let mut app_state = state.write();
    if let Some(tx) = app_state.pending_receives.remove(&sender_ip) {
        let _ = tx.send(accept);
    }
    Ok(())
}

#[tauri::command]
async fn send_files_to_device(
    target_ips: Vec<String>,
    target_port: u16,
    state: tauri::State<'_, Arc<parking_lot::RwLock<AppState>>>,
) -> Result<serde_json::Value, AppError> {
    let (sender_name, sender_port, sender_ip, files, pin) = {
        let app_state = state.read();
        let name = app_state.config.server_name.clone();
        let port = app_state.server_port;
        let ip = app_state.local_ip.clone()
            .unwrap_or_else(|| {
                network::discovery::get_all_local_ips().first().cloned()
                    .unwrap_or_else(|| "127.0.0.1".to_string())
            });
        let files = app_state.get_files_ordered();
        let pin = if app_state.config.require_pin {
            app_state.config.pin_code.clone()
        } else {
            None
        };
        (name, port, ip, files, pin)
    };

    if files.is_empty() {
        return Err(AppError::Server("No shared files to send".into()));
    }

    let files_payload: Vec<serde_json::Value> = files.into_iter().map(|f| {
        serde_json::json!({
            "id": f.id,
            "name": f.name,
            "size": f.size,
        })
    }).collect();

    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read, Write};
        let mut stream_opt = None;
        let mut connected_ip = None;

        for ip in &target_ips {
            let address = format!("{}:{}", ip, target_port);
            if let Ok(addr) = address.parse() {
                if let Ok(stream) = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(2)) {
                    stream_opt = Some(stream);
                    connected_ip = Some(ip.clone());
                    break;
                }
            }
        }

        let mut stream = stream_opt.ok_or_else(|| AppError::Server("Failed to connect to receiver on any IP address".into()))?;
        let actual_sender_ip = stream.local_addr()
            .map(|addr| addr.ip().to_string())
            .unwrap_or(sender_ip);

        let payload = serde_json::json!({
            "senderName": sender_name,
            "senderIp": actual_sender_ip,
            "senderPort": sender_port,
            "files": files_payload,
            "pin": pin,
        });

        let body = serde_json::to_string(&payload).map_err(|e| AppError::Server(e.to_string()))?;
        let address = format!("{}:{}", connected_ip.unwrap(), target_port);
        let request = format!(
            "POST /api/receive-request HTTP/1.1\r\n\
             Host: {}\r\n\
             Content-Type: application/json\r\n\
             Content-Length: {}\r\n\
             Connection: close\r\n\r\n\
             {}",
            address, body.len(), body
        );

        stream.write_all(request.as_bytes()).map_err(|e| AppError::Server(format!("Failed to write: {e}")))?;
        stream.flush().map_err(|e| AppError::Server(e.to_string()))?;

        let mut response_bytes = Vec::new();
        stream.read_to_end(&mut response_bytes).map_err(|e| AppError::Server(format!("Failed to read response: {e}")))?;

        let response_str = String::from_utf8_lossy(&response_bytes);
        if let Some(body_start) = response_str.find("\r\n\r\n") {
            let json_body = &response_str[body_start + 4..];
            let parsed: serde_json::Value = serde_json::from_str(json_body)
                .map_err(|e| AppError::Server(format!("Failed to parse response JSON ({json_body}): {e}")))?;
            Ok(parsed)
        } else {
            Err(AppError::Server("Invalid HTTP response".into()))
        }
    }).await.map_err(|e| AppError::Server(format!("Blocking task error: {e}")))?
}

#[tauri::command]
async fn download_remote_file(
    app: tauri::AppHandle,
    sender_ip: String,
    sender_port: u16,
    file_id: String,
    file_name: String,
    file_size: u64,
    pin: Option<String>,
) -> Result<(), AppError> {
    server::routes::download_file_from_remote(app, sender_ip, sender_port, file_id, file_name, file_size, pin)
        .await
        .map_err(AppError::Server)
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

            // Start the UDP discovery background listener
            network::discovery::start_discovery_listener(app_state_clone.clone(), app.handle().clone());

            // Initialize local IP (but do NOT auto-start the server — user must press Start)
            let ips = network::discovery::get_all_local_ips();
            {
                let mut state = app_state_clone.write();
                state.local_ip = ips.first().cloned();
            }
            // Note: Server auto-start is intentionally disabled. The user must press
            // "Start Sharing Portal" to begin sharing. This also means no broadcast fires on boot.

            // Check for firewall rule (Windows) using the dynamically configured port!
            #[cfg(target_os = "windows")]
            {
                let port = app_state_clone.read().config.port;
                let _ = network::firewall::ensure_firewall_rule(port);
            }

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
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
            }

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
            update_config,
            discover_devices,
            respond_to_receive_request,
            send_files_to_device,
            download_remote_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
