// src-tauri/src/network/discovery.rs
// LAN IP address detection.

use local_ip_address::{list_afinet_netifas, local_ip};

/// Get the primary local IP address (usually the default route interface).
pub fn get_primary_local_ip() -> Option<String> {
    match local_ip() {
        Ok(ip) => {
            let s = ip.to_string();
            log::info!("Primary local IP: {s}");
            Some(s)
        }
        Err(e) => {
            log::warn!("Could not detect primary local IP: {e}");
            None
        }
    }
}

/// Get all non-loopback IPv4 addresses on this machine, prioritizing physical adapters.
pub fn get_all_local_ips() -> Vec<String> {
    match list_afinet_netifas() {
        Ok(ifas) => {
            let mut ips: Vec<(String, String)> = ifas
                .into_iter()
                .filter(|(_name, ip)| ip.is_ipv4() && !ip.is_loopback())
                .map(|(name, ip)| (name, ip.to_string()))
                .collect();
            
            // Prioritize hotspot and physical adapters (Wi-Fi, Ethernet) over virtual adapters
            ips.sort_by_key(|(name, ip)| {
                let name_lower = name.to_lowercase();
                let is_virtual = name_lower.contains("virtual")
                    || name_lower.contains("vbox")
                    || name_lower.contains("wsl")
                    || name_lower.contains("vmware")
                    || name_lower.contains("host-only")
                    || name_lower.contains("hyper-v")
                    || name_lower.contains("docker")
                    || name_lower.contains("switch")
                    || name_lower.contains("ethernet 2")
                    || name_lower.contains("ethernet 3");
                
                let is_hotspot = ip.starts_with("192.168.137.");
                let is_preferred_range = ip.starts_with("192.168.") || ip.starts_with("10.");
                
                // Score:
                // 0: Active Windows Mobile Hotspot subnet (192.168.137.x) - absolute highest priority
                // 1: Other physical preferred LAN IP (Wi-Fi/Ethernet)
                // 2: Other physical IP
                // 3: Virtual preferred IP
                // 4: Virtual other IP
                if is_hotspot {
                    0
                } else {
                    match (is_virtual, is_preferred_range) {
                        (false, true) => 1,
                        (false, false) => 2,
                        (true, true) => 3,
                        (true, false) => 4,
                    }
                }
            });

            let sorted_ips: Vec<String> = ips.into_iter().map(|(_, ip)| ip).collect();
            log::info!("Detected and prioritized local IPv4 addresses: {:?}", sorted_ips);
            sorted_ips
        }
        Err(e) => {
            log::warn!("Could not list network interfaces: {e}");
            // Fallback: try the primary IP
            get_primary_local_ip().into_iter().collect()
        }
    }
}

/// Build the full server URL for a given IP and port.
pub fn build_server_url(ip: &str, port: u16) -> String {
    format!("http://{}:{}", ip, port)
}
