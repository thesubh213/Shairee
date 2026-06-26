// src-tauri/src/network/discovery.rs
// LAN IP address detection.

use local_ip_address::{list_afinet_netifas, local_ip};

/// Get the primary local IP address (usually the default route interface).
pub fn get_primary_local_ip() -> Option<String> {
    match local_ip() {
        Ok(ip) => Some(ip.to_string()),
        Err(_) => None,
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
            
            let primary_ip = get_primary_local_ip();
            
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
                let is_primary = Some(ip.clone()) == primary_ip;
                let is_preferred_range = ip.starts_with("192.168.") || ip.starts_with("10.");
                
                // Score:
                // 0: Active Windows Mobile Hotspot subnet (192.168.137.x) - absolute highest priority
                // 1: Primary default route IP
                // 2: Other physical preferred LAN IP (Wi-Fi/Ethernet)
                // 3: Other physical IP
                // 4: Virtual preferred IP
                // 5: Virtual other IP
                if is_hotspot {
                    0
                } else if is_primary {
                    1
                } else {
                    match (is_virtual, is_preferred_range) {
                        (false, true) => 2,
                        (false, false) => 3,
                        (true, true) => 4,
                        (true, false) => 5,
                    }
                }
            });

            let sorted_ips: Vec<String> = ips.into_iter().map(|(_, ip)| ip).collect();
            sorted_ips
        }
        Err(_) => {
            // Fallback: try the primary IP
            get_primary_local_ip().into_iter().collect()
        }
    }
}

/// Build the full server URL for a given IP and port.
pub fn build_server_url(ip: &str, port: u16) -> String {
    format!("http://{}:{}", ip, port)
}

/// Resolve local system device name.
pub fn get_device_name() -> String {
    if let Ok(name) = std::env::var("COMPUTERNAME") {
        return name;
    }
    if let Ok(name) = std::fs::read_to_string("/proc/sys/kernel/hostname") {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Ok(name) = std::env::var("HOSTNAME") {
        return name;
    }
    "Shairee Device".to_string()
}

/// Proactively broadcast presence to the LAN so receivers already scanning can find us.
/// Call this whenever the server starts.
pub fn broadcast_presence(device_name: &str, port: u16, require_pin: bool) {
    let msg = format!("SHAIREE_SERVER|{}|{}|{}", device_name, port, require_pin);
    let msg_bytes = msg.into_bytes();
    let local_ips = get_all_local_ips();
    
    std::thread::spawn(move || {
        let mut sockets = Vec::new();
        for ip in &local_ips {
            if let Ok(addr) = format!("{}:0", ip).parse::<std::net::SocketAddr>() {
                if let Ok(socket) = std::net::UdpSocket::bind(addr) {
                    let _ = socket.set_broadcast(true);
                    sockets.push((socket, addr.ip()));
                }
            }
        }
        
        // Fallback to binding 0.0.0.0 if no specific interfaces bound successfully
        if sockets.is_empty() {
            if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
                let _ = socket.set_broadcast(true);
                sockets.push((socket, std::net::IpAddr::V4(std::net::Ipv4Addr::new(0,0,0,0))));
            }
        }

        // Send 3 rapid broadcasts to improve reliability over lossy networks
        for _ in 0..3 {
            for (socket, ip) in &sockets {
                // Send to general broadcast
                let _ = socket.send_to(&msg_bytes, "255.255.255.255:8389");
                
                // Send to class C subnet broadcast
                if let std::net::IpAddr::V4(ipv4) = ip {
                    if !ipv4.is_unspecified() {
                        let octets = ipv4.octets();
                        let subnet_bcast = format!("{}.{}.{}.255:8389", octets[0], octets[1], octets[2]);
                        let _ = socket.send_to(&msg_bytes, &subnet_bcast);
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    });
}

/// Listen for incoming UDP discovery broadcasts on port 8389.
pub fn start_discovery_listener(
    app_state: std::sync::Arc<parking_lot::RwLock<crate::state::AppState>>,
    _app_handle: tauri::AppHandle,
) {
    std::thread::spawn(move || {
        let socket = match std::net::UdpSocket::bind("0.0.0.0:8389") {
            Ok(s) => s,
            Err(_) => {
                // Port 8389 is unavailable; other devices will not find this
                // device automatically via discovery. Not fatal — continue.
                return;
            }
        };

        let mut buf = [0u8; 1024];
        loop {
            match socket.recv_from(&mut buf) {
                Ok((amt, src)) => {
                    let msg = String::from_utf8_lossy(&buf[..amt]);
                    if msg == "SHAIREE_DISCOVER" {
                        // Someone is scanning — reply only if our server is running
                        let state = app_state.read();
                        if state.server_running {
                            let device_name = state.config.server_name.clone();
                            let port = state.server_port;
                            let require_pin = state.config.require_pin;
                            let reply = format!("SHAIREE_SERVER|{}|{}|{}", device_name, port, require_pin);
                            let _ = socket.send_to(reply.as_bytes(), src);
                        }
                    }
                }
                Err(_) => {
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                }
            }
        }
    });
}
