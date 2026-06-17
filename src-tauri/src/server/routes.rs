use actix_web::{web, HttpRequest, HttpResponse, Responder};
use serde_json::json;
use crate::server::ServerState;
use crate::server::streaming;
use crate::state::AppState;
use tauri::Emitter;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use parking_lot::RwLock;
use futures_util::Stream;
use actix_web::web::Bytes;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

/// Helper function to validate authorization PIN.
/// Logs failed auth attempts for security monitoring.
fn is_auth_valid(req: &HttpRequest, app_state: &AppState) -> bool {
    if !app_state.config.require_pin {
        return true;
    }

    // Get the expected PIN
    let Some(expected_pin) = &app_state.config.pin_code else {
        // require_pin is true but pin_code is None - treat as no PIN set (open access)
        return true;
    };

    // Try Bearer token auth
    if let Some(auth_header) = req.headers().get("Authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                if crate::security::validate_pin(token, expected_pin) {
                    return true;
                } else {
                    log_auth_failure(req, "invalid_bearer_token");
                    return false;
                }
            }
        } else {
            log_auth_failure(req, "invalid_auth_header_encoding");
            return false;
        }
    }

    // Try query parameter auth - extract only the first auth parameter
    if let Some(query_str) = req.query_string().split_once("auth=") {
        let param_value = query_str.1.split('&').next().unwrap_or("");
        // URL decode the parameter using percent-encoding
        let decoded = percent_encoding::percent_decode_str(param_value)
            .decode_utf8_lossy();
        if crate::security::validate_pin(&decoded, expected_pin) {
            return true;
        } else {
            log_auth_failure(req, "invalid_query_auth");
            return false;
        }
    }

    log_auth_failure(req, "no_auth_provided");
    false
}

/// Log authentication failure for security audit trail.
fn log_auth_failure(req: &HttpRequest, reason: &str) {
    let ip = req.peer_addr()
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    log::warn!("Authentication failure from {}: {}", ip, reason);
}

/// Custom Stream wrapper that handles progress logging updates and Drop-based temp file cleanup.
pub struct ProgressStreamWrapper<S> {
    inner: S,
    transfer_id: String,
    app_state: Arc<RwLock<AppState>>,
    temp_file: Option<PathBuf>,
    is_completed: bool,
}

impl<S> Stream for ProgressStreamWrapper<S>
where
    S: Stream<Item = Result<Bytes, actix_web::Error>> + Unpin,
{
    type Item = Result<Bytes, actix_web::Error>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        let res = futures_util::ready!(std::pin::Pin::new(&mut self.inner).poll_next(cx));
        if res.is_none() {
            self.is_completed = true;
        }
        std::task::Poll::Ready(res)
    }
}

impl<S> Drop for ProgressStreamWrapper<S> {
    fn drop(&mut self) {
        if !self.is_completed {
            // Stream terminated prematurely or aborted!
            {
                let mut st = self.app_state.write();
                st.record_failed(&self.transfer_id);
            }
            if let Some(path) = &self.temp_file {
                let path_clone = path.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = tokio::fs::remove_file(path_clone).await;
                });
            }
        }
    }
}

/// Create an asynchronous progress stream for the file.
fn create_progress_stream(
    file_path: PathBuf,
    file_id: String,
    file_name: String,
    file_size: u64,
    client_ip: String,
    tauri_app: tauri::AppHandle,
    app_state: Arc<RwLock<AppState>>,
    transfer_id: String,
    is_temp_zip: bool,
) -> impl Stream<Item = Result<Bytes, actix_web::Error>> {
    let output_path_clone = file_path.clone();
    
    let state_tuple = (
        Option::<File>::None, 
        0u64,                 
        std::time::Instant::now(), 
        file_path,
    );

    let progress_stream = futures_util::stream::unfold(
        state_tuple,
        move |(file_opt, mut bytes_sent, mut last_emit, path)| {
            let tauri_app = tauri_app.clone();
            let app_state = app_state.clone();
            let file_id = file_id.clone();
            let file_name = file_name.clone();
            let client_ip = client_ip.clone();
            let transfer_id = transfer_id.clone();
            let temp_zip_path = output_path_clone.clone();

            async move {
                let mut file = match file_opt {
                    Some(f) => f,
                    None => {
                        match File::open(&path).await {
                            Ok(f) => f,
                            Err(e) => {
                                log::error!("Failed to open file: {e}");
                                {
                                    let mut st = app_state.write();
                                    st.record_failed(&transfer_id);
                                }
                                return Some((Err(actix_web::error::ErrorInternalServerError(e)), (None, bytes_sent, last_emit, path)));
                            }
                        }
                    }
                };

                let mut buf = vec![0u8; 65536];
                match file.read(&mut buf).await {
                    Ok(0) => {
                        let _ = tauri_app.emit("transfer-complete", serde_json::json!({
                            "fileId": file_id,
                            "fileName": file_name,
                            "clientIp": client_ip,
                        }));
                        {
                            let mut st = app_state.write();
                            st.record_complete(&transfer_id);
                        }
                        
                        if is_temp_zip {
                            let _ = tokio::fs::remove_file(&temp_zip_path).await;
                        }

                        None
                    }
                    Ok(n) => {
                        bytes_sent += n as u64;
                        let now = std::time::Instant::now();
                        if now.duration_since(last_emit).as_millis() > 150 {
                            let _ = tauri_app.emit("transfer-progress", serde_json::json!({
                                "fileId": file_id,
                                "fileName": file_name,
                                "clientIp": client_ip,
                                "bytesTransferred": bytes_sent,
                                "totalBytes": file_size,
                                "speedBps": 0,
                            }));
                            {
                                let mut st = app_state.write();
                                st.update_progress(&transfer_id, bytes_sent);
                            }
                            last_emit = now;
                        }
                        buf.truncate(n);
                        Some((Ok(Bytes::from(buf)), (Some(file), bytes_sent, last_emit, path)))
                    }
                    Err(e) => {
                        log::error!("Error reading streaming chunk: {e}");
                        {
                            let mut st = app_state.write();
                            st.record_failed(&transfer_id);
                        }
                        if is_temp_zip {
                            let _ = tokio::fs::remove_file(&temp_zip_path).await;
                        }
                        Some((Err(actix_web::error::ErrorInternalServerError(e)), (Some(file), bytes_sent, last_emit, path)))
                    }
                }
            }
        }
    );

    Box::pin(progress_stream)
}

pub async fn get_status(state: web::Data<ServerState>) -> impl Responder {
    let app_state = state.app_state.read();
    let is_auth = app_state.config.require_pin;
    
    HttpResponse::Ok().json(json!({
        "serverRunning": app_state.server_running,
        "authRequired": is_auth,
        "activeConnections": app_state.ws_client_count,
    }))
}

pub async fn list_files(req: HttpRequest, state: web::Data<ServerState>) -> Result<HttpResponse, actix_web::Error> {
    let app_state = state.app_state.read();
    if !is_auth_valid(&req, &app_state) {
        return Ok(HttpResponse::Unauthorized().json(json!({"error": "Unauthorized"})));
    }

    Ok(HttpResponse::Ok().json(&app_state.get_files_ordered()))
}

pub async fn download_file(
    req: HttpRequest,
    path: web::Path<String>,
    state: web::Data<ServerState>,
) -> Result<HttpResponse, actix_web::Error> {
    let file_id = path.into_inner();
    download_file_impl(req, file_id, state).await
}

pub async fn download_file_with_name(
    req: HttpRequest,
    path: web::Path<(String, String)>,
    state: web::Data<ServerState>,
) -> Result<HttpResponse, actix_web::Error> {
    let (file_id, _name) = path.into_inner();
    download_file_impl(req, file_id, state).await
}

async fn download_file_impl(
    req: HttpRequest,
    file_id: String,
    state: web::Data<ServerState>,
) -> Result<HttpResponse, actix_web::Error> {
    // Validate file ID format (must be UUID)
    if let Err(_e) = crate::security::validate_file_id(&file_id) {
        log::warn!("Invalid file ID format attempted: {}", file_id);
        return Ok(HttpResponse::BadRequest().json(json!({"error": "Invalid file ID"})));
    }

    // Auth check
    {
        let app_state = state.app_state.read();
        if !is_auth_valid(&req, &app_state) {
            return Ok(HttpResponse::Unauthorized().finish());
        }
    }

    let file_info = {
        let app_state = state.app_state.read();
        app_state.shared_files.get(&file_id).cloned()
    };

    if let Some(info) = file_info {
        // Re-validate file exists immediately before serving (minimize TOCTOU window)
        if let Err(e) = crate::security::validate_file_exists_and_readable(std::path::Path::new(&info.path)) {
            log::error!("File no longer accessible during download: {}", e);
            return Ok(HttpResponse::NotFound().json(json!({"error": "File not found"})));
        }

        let remote_ip = req.peer_addr().map(|a| a.ip().to_string()).unwrap_or_else(|| "unknown".into());

        if info.is_directory {
            // Compress folder to a secure temp path on the fly
            let temp_zip_path = streaming::get_temp_zip_path(&info.name);
            
            match streaming::create_zip_from_directory(Path::new(&info.path), &info.name, &temp_zip_path) {
                Ok(_) => {
                    // Re-validate temp file was created successfully
                    let zip_metadata = std::fs::metadata(&temp_zip_path)
                        .map_err(|e| {
                            log::error!("Failed to stat temp zip: {}", e);
                            actix_web::error::ErrorInternalServerError("Zip creation failed")
                        })?;
                    let zip_size = zip_metadata.len();
                    
                    let transfer_id = {
                        let mut app_state = state.app_state.write();
                        app_state.record_start(&info.id, &format!("{}.zip", info.name), zip_size, &remote_ip)
                    };

                    let raw_stream = create_progress_stream(
                        temp_zip_path.clone(),
                        info.id.clone(),
                        format!("{}.zip", info.name),
                        zip_size,
                        remote_ip,
                        state.tauri_app.clone(),
                        state.app_state.clone(),
                        transfer_id.clone(),
                        true,
                    );

                    let wrapped_stream = ProgressStreamWrapper {
                        inner: raw_stream,
                        transfer_id,
                        app_state: state.app_state.clone(),
                        temp_file: Some(temp_zip_path),
                        is_completed: false,
                    };

                    let filename = format!("{}.zip", info.name);
                    Ok(HttpResponse::Ok()
                        .content_type("application/zip")
                        .insert_header(actix_web::http::header::ContentDisposition {
                            disposition: actix_web::http::header::DispositionType::Attachment,
                            parameters: vec![actix_web::http::header::DispositionParam::Filename(filename)],
                        })
                        .streaming(wrapped_stream))
                }
                Err(e) => {
                    log::error!("Zip folder error: {e}");
                    Ok(HttpResponse::InternalServerError().body(e))
                }
            }
        } else {
            // Stream standard file with progress tracking
            let transfer_id = {
                let mut app_state = state.app_state.write();
                app_state.record_start(&info.id, &info.name, info.size, &remote_ip)
            };

            let raw_stream = create_progress_stream(
                PathBuf::from(&info.path),
                info.id.clone(),
                info.name.clone(),
                info.size,
                remote_ip,
                state.tauri_app.clone(),
                state.app_state.clone(),
                transfer_id.clone(),
                false,
            );

            let wrapped_stream = ProgressStreamWrapper {
                inner: raw_stream,
                transfer_id,
                app_state: state.app_state.clone(),
                temp_file: None,
                is_completed: false,
            };

            Ok(HttpResponse::Ok()
                .content_type(mime_guess::from_path(&info.path).first_or_octet_stream().to_string())
                .insert_header(actix_web::http::header::ContentDisposition {
                    disposition: actix_web::http::header::DispositionType::Attachment,
                    parameters: vec![actix_web::http::header::DispositionParam::Filename(info.name.clone())],
                })
                .streaming(wrapped_stream))
        }
    } else {
        Ok(HttpResponse::NotFound().finish())
    }
}

pub async fn download_all(
    req: HttpRequest,
    state: web::Data<ServerState>,
) -> Result<HttpResponse, actix_web::Error> {
    // Auth check
    {
        let app_state = state.app_state.read();
        if !is_auth_valid(&req, &app_state) {
            return Ok(HttpResponse::Unauthorized().finish());
        }
    }

    let files_to_zip: Vec<(String, PathBuf)> = {
        let app_state = state.app_state.read();
        app_state.get_files_ordered()
            .into_iter()
            .map(|f| (f.name, PathBuf::from(f.path)))
            .collect()
    };

    if files_to_zip.is_empty() {
        return Ok(HttpResponse::BadRequest().body("No files are currently being shared."));
    }

    let temp_zip_path = streaming::get_temp_zip_path("shairee_all");
    let remote_ip = req.peer_addr().map(|a| a.ip().to_string()).unwrap_or_else(|| "unknown".into());

    // Zip all files directly to disk
    match streaming::create_zip_from_files(&files_to_zip, &temp_zip_path) {
        Ok(_) => {
            // Verify temp file was created and readable
            let zip_metadata = match std::fs::metadata(&temp_zip_path) {
                Ok(metadata) => metadata,
                Err(e) => {
                    log::error!("Temp ZIP created but cannot stat it: {}", e);
                    // Clean up the temp file
                    let _ = std::fs::remove_file(&temp_zip_path);
                    return Ok(HttpResponse::InternalServerError()
                        .body(format!("Zip file created but cannot read metadata: {}", e)));
                }
            };
            
            let zip_size = zip_metadata.len();
            
            // Sanity check: ensure ZIP file has content
            if zip_size == 0 {
                log::error!("Temp ZIP created but is empty");
                let _ = std::fs::remove_file(&temp_zip_path);
                return Ok(HttpResponse::InternalServerError()
                    .body("Zip file is empty"));
            }

            let transfer_id = {
                let mut app_state = state.app_state.write();
                app_state.record_start("all", "shairee_all.zip", zip_size, &remote_ip)
            };

            let raw_stream = create_progress_stream(
                temp_zip_path.clone(),
                "all".to_string(),
                "shairee_all.zip".to_string(),
                zip_size,
                remote_ip,
                state.tauri_app.clone(),
                state.app_state.clone(),
                transfer_id.clone(),
                true,
            );

            let wrapped_stream = ProgressStreamWrapper {
                inner: raw_stream,
                transfer_id,
                app_state: state.app_state.clone(),
                temp_file: Some(temp_zip_path),
                is_completed: false,
            };

            Ok(HttpResponse::Ok()
                .content_type("application/zip")
                .insert_header(actix_web::http::header::ContentDisposition {
                    disposition: actix_web::http::header::DispositionType::Attachment,
                    parameters: vec![actix_web::http::header::DispositionParam::Filename("shairee_all.zip".into())],
                })
                .streaming(wrapped_stream))
        }
        Err(e) => {
            log::error!("Zip all files error: {}", e);
            // Clean up the temp file if it was partially created
            let _ = std::fs::remove_file(&temp_zip_path);
            Ok(HttpResponse::InternalServerError().body(format!("Failed to create archive: {}", e)))
        }
    }
}

// ─── Incoming File Transfers & Discovery ─────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingFileRequest {
    pub sender_name: String,
    pub sender_ip: String,
    pub sender_port: u16,
    pub files: Vec<IncomingFileInfo>,
    pub pin: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingFileInfo {
    pub id: String,
    pub name: String,
    pub size: u64,
}

/// Helper function to asynchronously pull files from sender and save to Downloads
pub async fn download_file_from_remote(
    app: tauri::AppHandle,
    sender_ip: String,
    sender_port: u16,
    file_id: String,
    file_name: String,
    file_size: u64,
    pin: Option<String>,
) -> Result<(), String> {
    use tauri::Manager;
    
    // Resolve AppState
    let state = app.state::<std::sync::Arc<parking_lot::RwLock<crate::state::AppState>>>();
    
    // Start pull record in AppState logs
    let transfer_id = {
        let mut st = state.write();
        st.record_start_pull(&file_id, &file_name, file_size, &sender_ip)
    };

    // Helper closure to mark failed in AppState
    let mark_failed = |err_msg: &str| {
        let mut st = state.write();
        st.record_failed(&transfer_id);
        err_msg.to_string()
    };

    #[cfg(target_os = "android")]
    let download_dir = {
        let mut path = std::path::PathBuf::from("/storage/emulated/0/Android/data/com.shairee.portal/files/Download");
        if let Ok(local_path) = app.path().app_local_data_dir() {
            if !path.exists() {
                let _ = std::fs::create_dir_all(&path);
            }
            if !path.exists() {
                path = local_path.join("Download");
            }
        }
        path
    };
    #[cfg(not(target_os = "android"))]
    let download_dir = app.path().download_dir().map_err(|e| mark_failed(&e.to_string()))?;
    
    // Ensure downloads folder exists
    let _ = tokio::fs::create_dir_all(&download_dir).await;
    let target_path = download_dir.join(&file_name);

    let client = reqwest::Client::new();
    let url = if let Some(p) = &pin {
        format!("http://{}:{}/api/download/{}?auth={}", sender_ip, sender_port, file_id, percent_encoding::utf8_percent_encode(p, percent_encoding::NON_ALPHANUMERIC))
    } else {
        format!("http://{}:{}/api/download/{}", sender_ip, sender_port, file_id)
    };

    let mut response = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => return Err(mark_failed(&e.to_string())),
    };

    if !response.status().is_success() {
        return Err(mark_failed(&format!("Server returned error code: {}", response.status())));
    }

    let mut file = match tokio::fs::File::create(&target_path).await {
        Ok(f) => f,
        Err(e) => return Err(mark_failed(&e.to_string())),
    };

    let mut bytes_downloaded = 0u64;
    let mut last_emit = std::time::Instant::now();

    // Trigger initial progress event in UI
    let _ = app.emit("transfer-progress", serde_json::json!({
        "fileId": file_id,
        "fileName": file_name,
        "clientIp": sender_ip,
        "bytesTransferred": 0,
        "totalBytes": file_size,
        "speedBps": 0,
        "isDownload": true
    }));

    loop {
        let chunk = match response.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return Err(mark_failed(&e.to_string())),
        };

        use tokio::io::AsyncWriteExt;
        if let Err(e) = file.write_all(&chunk).await {
            return Err(mark_failed(&e.to_string()));
        }
        bytes_downloaded += chunk.len() as u64;

        let now = std::time::Instant::now();
        if now.duration_since(last_emit).as_millis() > 200 {
            {
                let mut st = state.write();
                st.update_progress(&transfer_id, bytes_downloaded);
            }
            let _ = app.emit("transfer-progress", serde_json::json!({
                "fileId": file_id,
                "fileName": file_name,
                "clientIp": sender_ip,
                "bytesTransferred": bytes_downloaded,
                "totalBytes": file_size,
                "speedBps": 0,
                "isDownload": true
            }));
            last_emit = now;
        }
    }
    
    use tokio::io::AsyncWriteExt;
    let _ = file.flush().await;

    // Record complete in AppState logs
    {
        let mut st = state.write();
        st.record_complete(&transfer_id);
    }

    // Trigger completion event
    let _ = app.emit("transfer-complete", serde_json::json!({
        "fileId": file_id,
        "fileName": file_name,
        "clientIp": sender_ip,
        "isDownload": true
    }));

    Ok(())
}

/// Endpoint called by the sender to request permission to transfer files.
pub async fn receive_request(
    req: HttpRequest,
    payload: web::Json<IncomingFileRequest>,
    state: web::Data<ServerState>,
) -> impl Responder {
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    // Resolve peer IP address (with fallback to self-reported payload IP)
    let peer_ip = req.peer_addr()
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|| payload.sender_ip.clone());

    // Save the responder channel in AppState
    {
        let mut app_state = state.app_state.write();
        app_state.pending_receives.insert(peer_ip.clone(), tx);
    }

    // Emit event to frontend UI to trigger the accept/decline dialog
    let _ = state.tauri_app.emit("incoming-transfer-request", serde_json::json!({
        "senderName": payload.sender_name,
        "senderIp": peer_ip,
        "senderPort": payload.sender_port,
        "files": payload.files,
    }));

    // Wait for response from UI (timeout in 30 seconds)
    match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(accepted)) => {
            if accepted {
                let app_handle = state.tauri_app.clone();
                let sender_ip_clone = peer_ip.clone();
                let sender_port = payload.sender_port;
                let files = payload.files.clone();
                let pin = payload.pin.clone();
                
                // Spawn async download task for the accepted files
                tauri::async_runtime::spawn(async move {
                    for f in files {
                        log::info!("Starting background pull for: {} ({} bytes)", f.name, f.size);
                        match download_file_from_remote(
                            app_handle.clone(),
                            sender_ip_clone.clone(),
                            sender_port,
                            f.id.clone(),
                            f.name.clone(),
                            f.size,
                            pin.clone(),
                        ).await {
                            Ok(_) => log::info!("Successfully pulled and saved file {}", f.name),
                            Err(e) => log::error!("Failed pulling remote file {}: {}", f.name, e),
                        }
                    }
                });

                HttpResponse::Ok().json(serde_json::json!({ "status": "accepted" }))
            } else {
                HttpResponse::Ok().json(serde_json::json!({ "status": "declined" }))
            }
        }
        _ => {
            // Remove the channel on timeout or drop
            {
                let mut app_state = state.app_state.write();
                app_state.pending_receives.remove(&peer_ip);
            }
            HttpResponse::Ok().json(serde_json::json!({ "status": "timeout" }))
        }
    }
}
