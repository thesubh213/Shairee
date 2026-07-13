


use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt;
use crate::state::SharedAppState;
use std::time::{Duration, Instant};


const WS_IDLE_TIMEOUT: Duration = Duration::from_secs(300);






pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    state: web::Data<SharedAppState>,
) -> Result<HttpResponse, actix_web::Error> {
    
    {
        let app_state = state.read();
        if app_state.config.require_pin {
            let auth_header = req.headers().get("Authorization");
            let query_auth = req.query_string().split_once("auth=")
                .map(|(_, rest)| rest.split('&').next().unwrap_or(""))
                .unwrap_or("");
            
            let valid = if let Some(pwd) = &app_state.config.pin_code {
                let mut is_valid = false;
                
                
                if let Some(auth) = auth_header {
                    if let Ok(auth_str) = auth.to_str() {
                        if let Some(token) = auth_str.strip_prefix("Bearer ") {
                            is_valid = crate::security::validate_pin(token, pwd);
                        }
                    }
                }
                
                
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

    
    {
        let mut st = state.write();
        st.ws_client_count += 1;
    }

    let state_clone = state.clone();
    let mut last_activity = Instant::now();

    
    actix_web::rt::spawn(async move {
        loop {
            
            let timeout_future = tokio::time::timeout(
                WS_IDLE_TIMEOUT.saturating_sub(last_activity.elapsed()),
                msg_stream.next()
            );

            match timeout_future.await {
                
                Err(_) => {
                    break;
                }
                
                Ok(Some(Ok(msg))) => {
                    last_activity = Instant::now();
                    match msg {
                        Message::Ping(bytes) => {
                            if session.pong(&bytes).await.is_err() {
                                break;
                            }
                        }
                        Message::Pong(_) => {
                            
                        }
                        Message::Text(_) => {
                            
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
                
                Ok(Some(Err(_))) | Ok(None) => break,
            }
        }

        
        let mut st = state_clone.write();
        st.ws_client_count = st.ws_client_count.saturating_sub(1);
        let _ = session.close(None).await;
    });

    Ok(response)
}
