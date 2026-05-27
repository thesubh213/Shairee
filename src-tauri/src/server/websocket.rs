// src-tauri/src/server/websocket.rs
// WebSocket support for real-time progress updates to mobile clients.

use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt;
use crate::state::SharedAppState;
use std::time::{Duration, Instant};

// Maximum idle time before disconnecting a WebSocket client (5 minutes)
const WS_IDLE_TIMEOUT: Duration = Duration::from_secs(300);

/// WebSocket endpoint handler.
/// Clients connect here to receive real-time notifications about:
/// - File list changes
/// - Transfer progress
/// - Server status updates
pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    state: web::Data<SharedAppState>,
) -> Result<HttpResponse, actix_web::Error> {
    // Auth check (reuse secure auth validation)
    {
        let app_state = state.read();
        if app_state.config.require_pin {
            let auth_header = req.headers().get("Authorization");
            let query_auth = req.query_string().split_once("auth=")
                .map(|(_, rest)| rest.split('&').next().unwrap_or(""))
                .unwrap_or("");
            
            let valid = if let Some(pwd) = &app_state.config.pin_code {
                let mut is_valid = false;
                
                // Check Bearer token
                if let Some(auth) = auth_header {
                    if let Ok(auth_str) = auth.to_str() {
                        if let Some(token) = auth_str.strip_prefix("Bearer ") {
                            is_valid = crate::security::validate_pin(token, pwd);
                        }
                    }
                }
                
                // Check query auth if Bearer failed
                if !is_valid && !query_auth.is_empty() {
                    let decoded = percent_encoding::percent_decode_str(query_auth)
                        .decode_utf8_lossy();
                    is_valid = crate::security::validate_pin(&decoded, pwd);
                }
                
                is_valid
            } else {
                true
            };
            
            if !valid {
                return Ok(HttpResponse::Unauthorized().finish());
            }
        }
    }

    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    // Track the connection
    {
        let mut st = state.write();
        st.ws_client_count += 1;
        log::info!("WebSocket client connected (total: {})", st.ws_client_count);
    }

    let state_clone = state.clone();
    let last_activity = Instant::now();

    // Spawn a task to handle incoming messages with timeout
    actix_web::rt::spawn(async move {
        loop {
            // Set idle timeout using tokio::time::timeout
            let timeout_future = tokio::time::timeout(
                WS_IDLE_TIMEOUT.saturating_sub(last_activity.elapsed()),
                msg_stream.next()
            );

            match timeout_future.await {
                // Timeout occurred - no message received within idle window
                Err(_) => {
                    log::debug!("WebSocket idle timeout after {} seconds", WS_IDLE_TIMEOUT.as_secs());
                    break;
                }
                // Message received successfully
                Ok(Some(Ok(msg))) => {
                    match msg {
                        Message::Ping(bytes) => {
                            if session.pong(&bytes).await.is_err() {
                                break;
                            }
                        }
                        Message::Pong(_) => {
                            // Client responded to our ping - keep-alive working
                        }
                        Message::Text(text) => {
                            log::debug!("WS received: {}", text);
                            // Acknowledge message
                            if session.text(r#"{"type":"ack"}"#).await.is_err() {
                                break;
                            }
                        }
                        Message::Close(_) => {
                            break;
                        }
                        _ => {}
                    }
                }
                // Stream error or other cases - disconnect
                Ok(Some(Err(_))) | Ok(None) => break,
            }
        }

        // Client disconnected
        let mut st = state_clone.write();
        st.ws_client_count = st.ws_client_count.saturating_sub(1);
        log::info!(
            "WebSocket client disconnected (remaining: {})",
            st.ws_client_count
        );
        let _ = session.close(None).await;
    });

    Ok(response)
}
