// src-tauri/src/config/mod.rs
// Application configuration with persistence.

use serde::{Deserialize, Serialize};

/// Application configuration, shared with the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// HTTP server port (default 8384)
    pub port: u16,

    /// Whether to auto-start the server on app launch
    pub auto_start_server: bool,

    /// Whether to show a system-tray notification on download
    pub notify_on_download: bool,

    /// Maximum concurrent downloads (0 = unlimited)
    pub max_concurrent_downloads: u32,

    /// Whether to require a PIN for access
    pub require_pin: bool,

    /// Optional PIN code (4-8 digits)
    pub pin_code: Option<String>,

    /// Custom server name shown in mobile UI
    pub server_name: String,

    /// Whether to auto-detect LAN IP
    pub auto_detect_ip: bool,

    /// Optional manual override IP
    pub manual_ip: Option<String>,

    /// Bind address (default "0.0.0.0")
    pub bind_address: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            port: 8384,
            auto_start_server: false,
            notify_on_download: true,
            max_concurrent_downloads: 0,
            require_pin: false,
            pin_code: None,
            server_name: "Shairee".into(),
            auto_detect_ip: true,
            manual_ip: None,
            bind_address: "0.0.0.0".into(),
        }
    }
}

impl AppConfig {
    /// Load config from disk, falling back to defaults.
    pub fn load(config_dir: &std::path::Path) -> Self {
        let path = config_dir.join("shairee_config.json");
        if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(data) => match serde_json::from_str::<AppConfig>(&data) {
                    Ok(cfg) => {
                        log::info!("Loaded config from {}", path.display());
                        return cfg;
                    }
                    Err(e) => {
                        log::warn!("Failed to parse config, using defaults: {e}");
                    }
                },
                Err(e) => {
                    log::warn!("Failed to read config file, using defaults: {e}");
                }
            }
        }
        let cfg = AppConfig::default();
        // Try to save defaults
        let _ = cfg.save(config_dir);
        cfg
    }

    /// Persist config to disk.
    pub fn save(&self, config_dir: &std::path::Path) -> Result<(), String> {
        std::fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
        let path = config_dir.join("shairee_config.json");
        let data = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&path, data).map_err(|e| e.to_string())?;
        log::info!("Saved config to {}", path.display());
        Ok(())
    }

    /// Validate configuration values.
    pub fn validate(&self) -> Result<(), String> {
        if self.port == 0 {
            return Err("Port cannot be 0".into());
        }
        if self.require_pin {
            match &self.pin_code {
                Some(pin) => {
                    if pin.len() < 4 || pin.len() > 8 || !pin.chars().all(|c| c.is_ascii_digit())
                    {
                        return Err("PIN must be 4-8 digits".into());
                    }
                }
                None => return Err("PIN is required when require_pin is enabled".into()),
            }
        }
        if !self.bind_address.is_empty()
            && self.bind_address != "0.0.0.0"
            && self.bind_address != "127.0.0.1"
            && self.bind_address.parse::<std::net::IpAddr>().is_err()
        {
            return Err(format!("Invalid bind address: {}", self.bind_address));
        }
        Ok(())
    }
}
