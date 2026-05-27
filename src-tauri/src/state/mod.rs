// src-tauri/src/state/mod.rs
// Shared application state, accessible from both Tauri and Actix threads.

use crate::config::AppConfig;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

// ─── Shared file info ────────────────────────────────────────────

/// Metadata for a file being shared.
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

// ─── Transfer tracking ──────────────────────────────────────────

/// A log entry for a completed (or in-progress) transfer.
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TransferStatus {
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

// ─── Server status ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatusInfo {
    pub running: bool,
    pub port: u16,
    pub url: Option<String>,
    pub local_ip: Option<String>,
    pub connected_clients: u32,
    pub total_downloads: u64,
    pub files_shared: usize,
}

// ─── Core application state ─────────────────────────────────────

/// The central application state, shared via Arc<RwLock<AppState>>.
pub struct AppState {
    /// Configuration
    pub config: AppConfig,

    /// Path to config directory for persistence
    pub config_dir: PathBuf,

    /// Shared files indexed by ID
    pub shared_files: HashMap<String, SharedFileInfo>,

    /// Order of file IDs (for stable display ordering)
    pub file_order: Vec<String>,

    /// Transfer log
    pub transfer_log: Vec<TransferRecord>,

    /// Whether the HTTP server is currently running
    pub server_running: bool,

    /// The port the server is actually bound to
    pub server_port: u16,

    /// The server's URL (e.g. http://192.168.1.42:8384)
    pub server_url: Option<String>,

    /// Detected local IP
    pub local_ip: Option<String>,

    /// Handle to the server thread for shutdown signaling
    pub server_stop_tx: Option<tokio::sync::oneshot::Sender<()>>,

    /// Connected WebSocket client count
    pub ws_client_count: u32,

    /// Total downloads since launch
    pub total_downloads: u64,
}

impl AppState {
    /// Create a new AppState with the given configuration.
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
        }
    }

    /// Add a shared file, returning its info.
    pub fn add_file(&mut self, path: PathBuf) -> Result<SharedFileInfo, String> {
        // Validate path length (Windows MAX_PATH consideration)
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
                dir_size(&path)  // dir_size already returns u64, returns 0 on error
            } else {
                metadata.len()
            },
            mime_type: mime,
            is_directory: metadata.is_dir(),
            added_at: Utc::now(),
        };

        // Bound check: prevent adding unbounded number of files
        if self.shared_files.len() >= 10000 {
            return Err("Maximum number of shared files reached (10000)".into());
        }

        self.shared_files.insert(id.clone(), info.clone());
        self.file_order.push(id);
        Ok(info)
    }

    /// Remove a shared file by ID.
    pub fn remove_file(&mut self, id: &str) -> Result<(), String> {
        if self.shared_files.remove(id).is_none() {
            return Err(format!("File not found: {id}"));
        }
        self.file_order.retain(|fid| fid != id);
        Ok(())
    }

    /// Clear all shared files.
    pub fn clear_files(&mut self) {
        self.shared_files.clear();
        self.file_order.clear();
    }

    /// Get ordered list of shared files.
    pub fn get_files_ordered(&self) -> Vec<SharedFileInfo> {
        self.file_order
            .iter()
            .filter_map(|id| self.shared_files.get(id).cloned())
            .collect()
    }

    /// Build a ServerStatusInfo snapshot.
    pub fn status_info(&self) -> ServerStatusInfo {
        ServerStatusInfo {
            running: self.server_running,
            port: self.server_port,
            url: self.server_url.clone(),
            local_ip: self.local_ip.clone(),
            connected_clients: self.ws_client_count,
            total_downloads: self.total_downloads,
            files_shared: self.shared_files.len(),
        }
    }

    /// Record a completed download.
    pub fn record_download(
        &mut self,
        file_id: &str,
        file_name: &str,
        file_size: u64,
        remote_addr: &str,
    ) {
        self.total_downloads += 1;
        let record = TransferRecord {
            id: uuid::Uuid::new_v4().to_string(),
            file_id: file_id.to_string(),
            file_name: file_name.to_string(),
            file_size,
            remote_addr: remote_addr.to_string(),
            started_at: Utc::now(),
            completed_at: Some(Utc::now()),
            bytes_sent: file_size,
            status: TransferStatus::Completed,
        };
        self.transfer_log.push(record);
    }

    /// Record the start of an asynchronous download.
    pub fn record_start(
        &mut self,
        file_id: &str,
        file_name: &str,
        file_size: u64,
        remote_addr: &str,
    ) -> String {
        // Clean up old transfer logs every 100 records to prevent unbounded growth
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
        };
        self.transfer_log.push(record);
        id
    }

    /// Update progress of an active download (use linear search with index caching).
    pub fn update_progress(&mut self, record_id: &str, bytes_sent: u64) {
        // Find by linear search - acceptable for small collections
        if let Some(pos) = self.transfer_log.iter().position(|r| r.id == record_id) {
            self.transfer_log[pos].bytes_sent = bytes_sent;
        }
    }

    /// Record successful completion of an active download.
    pub fn record_complete(&mut self, record_id: &str) {
        self.total_downloads += 1;
        if let Some(pos) = self.transfer_log.iter().position(|r| r.id == record_id) {
            self.transfer_log[pos].completed_at = Some(Utc::now());
            self.transfer_log[pos].bytes_sent = self.transfer_log[pos].file_size;
            self.transfer_log[pos].status = TransferStatus::Completed;
        }
    }

    /// Record failure of an active download.
    pub fn record_failed(&mut self, record_id: &str) {
        if let Some(pos) = self.transfer_log.iter().position(|r| r.id == record_id) {
            self.transfer_log[pos].completed_at = Some(Utc::now());
            self.transfer_log[pos].status = TransferStatus::Failed;
        }
    }

    /// Clean up transfer logs older than 24 hours to prevent unbounded memory growth.
    pub fn cleanup_old_transfer_logs(&mut self) {
        let cutoff = Utc::now() - chrono::Duration::days(1);
        self.transfer_log.retain(|record| record.started_at > cutoff);
    }

    /// Get transfer logs for display (maximum 100 most recent).
    pub fn get_recent_transfer_logs(&self) -> Vec<TransferRecord> {
        self.transfer_log.iter()
            .rev()
            .take(100)
            .cloned()
            .collect()
    }
}

/// Shared state handle — the canonical way to pass state around.
pub type SharedAppState = Arc<RwLock<AppState>>;

/// Recursively compute directory size, handling errors gracefully.
/// Returns 0 if the directory cannot be accessed (instead of panicking).
fn dir_size(path: &std::path::Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|e| {
            match e {
                Ok(entry) => Some(entry),
                Err(err) => {
                    // Log the error but continue processing other files
                    log::debug!("Error walking directory {}: {}", path.display(), err);
                    None
                }
            }
        })
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            match e.metadata() {
                Ok(m) => Some(m.len()),
                Err(err) => {
                    log::debug!("Error reading metadata for {}: {}", e.path().display(), err);
                    None
                }
            }
        })
        .sum()
}
