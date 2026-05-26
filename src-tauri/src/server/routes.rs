use actix_web::{web, HttpRequest, HttpResponse, Responder};
use serde_json::json;
use crate::server::ServerState;

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
    // Basic auth check
    let app_state = state.app_state.read();
    if app_state.config.require_pin {
        let auth_header = req.headers().get("Authorization");
        let query_auth = req.query_string().contains(&format!("auth={}", app_state.config.pin_code.as_deref().unwrap_or("")));
        
        let valid = if let Some(pwd) = &app_state.config.pin_code {
            if let Some(auth) = auth_header {
                let auth_str = auth.to_str().unwrap_or("");
                auth_str == format!("Bearer {}", pwd) || query_auth
            } else {
                query_auth
            }
        } else {
            true
        };

        if !valid {
            return Ok(HttpResponse::Unauthorized().json(json!({"error": "Unauthorized"})));
        }
    }

    Ok(HttpResponse::Ok().json(&app_state.get_files_ordered()))
}

use crate::server::streaming;
use std::path::PathBuf;

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
    // Auth check
    let mut is_auth_valid = true;
    {
        let app_state = state.app_state.read();
        if app_state.config.require_pin {
            let auth_header = req.headers().get("Authorization");
            let query_auth = req.query_string().contains(&format!("auth={}", app_state.config.pin_code.as_deref().unwrap_or("")));
            let valid = if let Some(pwd) = &app_state.config.pin_code {
                if let Some(auth) = auth_header {
                    let auth_str = auth.to_str().unwrap_or("");
                    auth_str == format!("Bearer {}", pwd) || query_auth
                } else {
                    query_auth
                }
            } else {
                true
            };
            if !valid {
                is_auth_valid = false;
            }
        }
    }

    if !is_auth_valid {
        return Ok(HttpResponse::Unauthorized().finish());
    }

    let file_info = {
        let app_state = state.app_state.read();
        app_state.shared_files.get(&file_id).cloned()
    };

    if let Some(info) = file_info {
        // Record download in state log
        {
            let mut app_state = state.app_state.write();
            let remote_ip = req.peer_addr().map(|a| a.ip().to_string()).unwrap_or_else(|| "unknown".into());
            app_state.record_download(&info.id, &info.name, info.size, &remote_ip);
        }

        if info.is_directory {
            // Compress folder on the fly and send
            match streaming::create_zip_from_directory(std::path::Path::new(&info.path), &info.name) {
                Ok(zip_bytes) => {
                    let filename = format!("{}.zip", info.name);
                    Ok(HttpResponse::Ok()
                        .content_type("application/zip")
                        .insert_header(actix_web::http::header::ContentDisposition {
                            disposition: actix_web::http::header::DispositionType::Attachment,
                            parameters: vec![actix_web::http::header::DispositionParam::Filename(filename)],
                        })
                        .body(zip_bytes))
                }
                Err(e) => {
                    log::error!("Zip folder error: {e}");
                    Ok(HttpResponse::InternalServerError().body(e))
                }
            }
        } else {
            // Stream standard file
            streaming::stream_file(std::path::Path::new(&info.path), &info.name, &req).await
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
    let mut is_auth_valid = true;
    {
        let app_state = state.app_state.read();
        if app_state.config.require_pin {
            let auth_header = req.headers().get("Authorization");
            let query_auth = req.query_string().contains(&format!("auth={}", app_state.config.pin_code.as_deref().unwrap_or("")));
            let valid = if let Some(pwd) = &app_state.config.pin_code {
                if let Some(auth) = auth_header {
                    let auth_str = auth.to_str().unwrap_or("");
                    auth_str == format!("Bearer {}", pwd) || query_auth
                } else {
                    query_auth
                }
            } else {
                true
            };
            if !valid {
                is_auth_valid = false;
            }
        }
    }

    if !is_auth_valid {
        return Ok(HttpResponse::Unauthorized().finish());
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

    // Zip all files on the fly and send
    match streaming::create_zip_from_files(&files_to_zip) {
        Ok(zip_bytes) => {
            Ok(HttpResponse::Ok()
                .content_type("application/zip")
                .insert_header(actix_web::http::header::ContentDisposition {
                    disposition: actix_web::http::header::DispositionType::Attachment,
                    parameters: vec![actix_web::http::header::DispositionParam::Filename("shairee_all.zip".into())],
                })
                .body(zip_bytes))
        }
        Err(e) => {
            log::error!("Zip all files error: {e}");
            Ok(HttpResponse::InternalServerError().body(e))
        }
    }
}
