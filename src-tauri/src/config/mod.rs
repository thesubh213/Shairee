


use serde::{Deserialize, Serialize};


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    
    pub port: u16,

    
    pub auto_start_server: bool,

    
    pub notify_on_download: bool,

    
    pub max_concurrent_downloads: u32,

    
    pub require_pin: bool,

    
    pub pin_code: Option<String>,

    
    pub server_name: String,

    
    pub auto_detect_ip: bool,

    
    pub manual_ip: Option<String>,

    
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
            server_name: crate::network::discovery::get_device_name(),
            auto_detect_ip: true,
            manual_ip: None,
            bind_address: "0.0.0.0".into(),
        }
    }
}

impl AppConfig {
    
    pub fn load(config_dir: &std::path::Path) -> Self {
        let path = config_dir.join("shairee_config.json");
        if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(data) => match serde_json::from_str::<AppConfig>(&data) {
                    Ok(cfg) => return cfg,
                    Err(_e) => {}
                },
                Err(_e) => {}
            }
        }
        let cfg = AppConfig::default();
        
        let _ = cfg.save(config_dir);
        cfg
    }

    
    pub fn save(&self, config_dir: &std::path::Path) -> Result<(), String> {
        std::fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
        let path = config_dir.join("shairee_config.json");
        let data = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&path, data).map_err(|e| e.to_string())?;
        Ok(())
    }

    
    pub fn validate(&self) -> Result<(), String> {
        
        if self.port == 0 {
            return Err("Port must be between 1 and 65535".into());
        }
        
        
        if self.require_pin {
            match &self.pin_code {
                Some(pin) => {
                    
                    if pin.is_empty() {
                        return Err("PIN cannot be empty when require_pin is enabled".into());
                    }
                    if pin.len() < 4 || pin.len() > 8 {
                        return Err(format!("PIN must be 4-8 digits, got {} chars", pin.len()));
                    }
                    if !pin.chars().all(|c| c.is_ascii_digit()) {
                        return Err("PIN must contain only digits (0-9)".into());
                    }
                }
                None => return Err("PIN code is required when require_pin is enabled".into()),
            }
        }
        
        
        if self.bind_address.is_empty() {
            return Err("Bind address cannot be empty".into());
        }
        
        
        if self.bind_address != "0.0.0.0"
            && self.bind_address != "127.0.0.1"
            && self.bind_address.parse::<std::net::IpAddr>().is_err()
        {
            return Err(format!("Invalid bind address: '{}' (must be valid IP or 0.0.0.0)", self.bind_address));
        }
        
        Ok(())
    }
}
