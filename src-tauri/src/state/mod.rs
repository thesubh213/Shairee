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
}

/// Shared state handle — the canonical way to pass state around.
pub type SharedAppState = Arc<RwLock<AppState>>;

/// Recursively compute directory size.
fn dir_size(path: &std::path::Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}
