// src-tauri/src/server/websocket.rs
// WebSocket support for real-time progress updates to mobile clients.

use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt;
use crate::state::SharedAppState;

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
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    // Track the connection
    {
        let mut st = state.write();
        st.ws_client_count += 1;
        log::info!("WebSocket client connected (total: {})", st.ws_client_count);
    }

    let state_clone = state.clone();

    // Spawn a task to handle incoming messages
    actix_web::rt::spawn(async move {
        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                Message::Ping(bytes) => {
                    if session.pong(&bytes).await.is_err() {
                        break;
                    }
                }
                Message::Text(text) => {
                    // Echo or handle commands
                    log::debug!("WS received: {text}");
                    // For now, acknowledge
                    if session
                        .text(r#"{"type":"ack"}"#)
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Message::Close(_) => {
                    break;
                }
                _ => {}
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
