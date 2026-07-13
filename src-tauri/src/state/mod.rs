


use crate::config::AppConfig;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;




#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFileInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub mime_type: String,
    pub is_directory: bool,
    pub added_at: DateTime<Utc>,
}




#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRecord {
    pub id: String,
    pub file_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub remote_addr: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub bytes_sent: u64,
    pub status: TransferStatus,
    pub is_download: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TransferStatus {
    InProgress,
    Completed,
    Failed,
    Cancelled,
}






pub struct AppState {
    
    pub config: AppConfig,

    
    pub config_dir: PathBuf,

    
    pub shared_files: HashMap<String, SharedFileInfo>,

    
    pub file_order: Vec<String>,

    
    pub transfer_log: Vec<TransferRecord>,

    
    pub server_running: bool,

    
    pub server_port: u16,

    
    pub server_url: Option<String>,

    
    pub local_ip: Option<String>,

    
    pub server_stop_tx: Option<tokio::sync::oneshot::Sender<()>>,

    
    pub ws_client_count: u32,

    
    pub total_downloads: u64,

    
    pub pending_receives: std::collections::HashMap<String, tokio::sync::oneshot::Sender<bool>>,

    
    pub auth_limiter: crate::security::rate_limit::AuthRateLimiter,
}

impl AppState {
    
    pub fn new(config: AppConfig, config_dir: PathBuf) -> Self {
        let port = config.port;
        Self {
            config,
            config_dir,
            shared_files: HashMap::new(),
            file_order: Vec::new(),
            transfer_log: Vec::new(),
            server_running: false,
            server_port: port,
            server_url: None,
            local_ip: None,
            server_stop_tx: None,
            ws_client_count: 0,
            total_downloads: 0,
            pending_receives: std::collections::HashMap::new(),
            auth_limiter: crate::security::rate_limit::AuthRateLimiter::new(
                5,
                std::time::Duration::from_secs(60),
                std::time::Duration::from_secs(300),
            ),
        }
    }

    
    pub fn add_file(&mut self, path: PathBuf) -> Result<SharedFileInfo, String> {
        
        crate::security::validate_path_length(path.to_string_lossy().as_ref())
            .map_err(|e| e.to_string())?;
        
        let metadata = std::fs::metadata(&path).map_err(|e| format!("Cannot read file: {e}"))?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".into());
        let mime = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .to_string();

        let id = uuid::Uuid::new_v4().to_string();
        let info = SharedFileInfo {
            id: id.clone(),
            name,
            path: path.to_string_lossy().to_string(),
            size: if metadata.is_dir() {
                dir_size(&path)  
            } else {
                metadata.len()
            },
            mime_type: mime,
            is_directory: metadata.is_dir(),
            added_at: Utc::now(),
        };

        
        if self.shared_files.len() >= 10000 {
            return Err("Maximum number of shared files reached (10000)".into());
        }

        self.shared_files.insert(id.clone(), info.clone());
        self.file_order.push(id);
        Ok(info)
    }

    
    pub fn remove_file(&mut self, id: &str) -> Result<(), String> {
        if self.shared_files.remove(id).is_none() {
            return Err(format!("File not found: {id}"));
        }
        self.file_order.retain(|fid| fid != id);
        Ok(())
    }

    
    pub fn clear_files(&mut self) {
        self.shared_files.clear();
        self.file_order.clear();
    }

    
    pub fn get_files_ordered(&self) -> Vec<SharedFileInfo> {
        self.file_order
            .iter()
            .filter_map(|id| self.shared_files.get(id).cloned())
            .collect()
    }

    

    
    pub fn record_start(
        &mut self,
        file_id: &str,
        file_name: &str,
        file_size: u64,
        remote_addr: &str,
    ) -> String {
        
        if self.transfer_log.len() % 100 == 0 {
            self.cleanup_old_transfer_logs();
        }
        
        let id = uuid::Uuid::new_v4().to_string();
        let record = TransferRecord {
            id: id.clone(),
            file_id: file_id.to_string(),
            file_name: file_name.to_string(),
            file_size,
            remote_addr: remote_addr.to_string(),
            started_at: Utc::now(),
            completed_at: None,
            bytes_sent: 0,
            status: TransferStatus::InProgress,
            is_download: false,
        };
        self.transfer_log.push(record);
        id
    }

    
    pub fn record_start_pull(
        &mut self,
        file_id: &str,
        file_name: &str,
        file_size: u64,
        remote_addr: &str,
    ) -> String {
        if self.transfer_log.len() % 100 == 0 {
            self.cleanup_old_transfer_logs();
        }
        
        let id = uuid::Uuid::new_v4().to_string();
        let record = TransferRecord {
            id: id.clone(),
            file_id: file_id.to_string(),
            file_name: file_name.to_string(),
            file_size,
            remote_addr: remote_addr.to_string(),
            started_at: Utc::now(),
            completed_at: None,
            bytes_sent: 0,
            status: TransferStatus::InProgress,
            is_download: true,
        };
        self.transfer_log.push(record);
        id
    }

    
    pub fn update_progress(&mut self, record_id: &str, bytes_sent: u64) {
        
        if let Some(pos) = self.transfer_log.iter().position(|r| r.id == record_id) {
            self.transfer_log[pos].bytes_sent = bytes_sent;
        }
    }

    
    pub fn record_complete(&mut self, record_id: &str) {
        self.total_downloads += 1;
        if let Some(pos) = self.transfer_log.iter().position(|r| r.id == record_id) {
            self.transfer_log[pos].completed_at = Some(Utc::now());
            self.transfer_log[pos].bytes_sent = self.transfer_log[pos].file_size;
            self.transfer_log[pos].status = TransferStatus::Completed;
        }
    }

    
    pub fn record_failed(&mut self, record_id: &str) {
        if let Some(pos) = self.transfer_log.iter().position(|r| r.id == record_id) {
            self.transfer_log[pos].completed_at = Some(Utc::now());
            self.transfer_log[pos].status = TransferStatus::Failed;
        }
    }

    
    pub fn cleanup_old_transfer_logs(&mut self) {
        let cutoff = Utc::now() - chrono::Duration::days(1);
        self.transfer_log.retain(|record| record.started_at > cutoff);
    }
}


pub type SharedAppState = Arc<RwLock<AppState>>;



fn dir_size(path: &std::path::Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|e| {
            match e {
                Ok(entry) => Some(entry),
                Err(_) => {
                    None
                }
            }
        })
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            match e.metadata() {
                Ok(m) => Some(m.len()),
                Err(_) => {
                    None
                }
            }
        })
        .sum()
}
