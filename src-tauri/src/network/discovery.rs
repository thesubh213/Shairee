


use local_ip_address::{list_afinet_netifas, local_ip};


pub fn get_primary_local_ip() -> Option<String> {
    match local_ip() {
        Ok(ip) => Some(ip.to_string()),
        Err(_) => None,
    }
}


pub fn get_all_local_ips() -> Vec<String> {
    match list_afinet_netifas() {
        Ok(ifas) => {
            let mut ips: Vec<(String, String)> = ifas
                .into_iter()
                .filter(|(_name, ip)| ip.is_ipv4() && !ip.is_loopback())
                .map(|(name, ip)| (name, ip.to_string()))
                .collect();
            
            let primary_ip = get_primary_local_ip();
            
            
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
                
                
                let is_android_hotspot = name_lower.contains("ap")
                    || name_lower.contains("swlan")
                    || name_lower.contains("softap")
                    || name_lower.contains("rndis")
                    || name_lower.contains("bridge");
                    
                let is_android_wifi = name_lower.contains("wlan");
                
                let is_android_deprioritized = name_lower.contains("rmnet")
                    || name_lower.contains("dummy")
                    || name_lower.contains("p2p")
                    || name_lower.contains("sit");

                let is_hotspot = ip.starts_with("192.168.137.") || is_android_hotspot;
                let is_primary = Some(ip.clone()) == primary_ip;
                let is_preferred_range = ip.starts_with("192.168.") || ip.starts_with("10.");
                
                
                
                
                
                
                
                
                if is_hotspot {
                    0
                } else if is_primary {
                    1
                } else if is_android_deprioritized {
                    4
                } else if is_android_wifi {
                    2
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
            
            get_primary_local_ip().into_iter().collect()
        }
    }
}


pub fn build_server_url(ip: &str, port: u16) -> String {
    format!("http://{}:{}", ip, port)
}


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
        
        
        if sockets.is_empty() {
            if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
                let _ = socket.set_broadcast(true);
                sockets.push((socket, std::net::IpAddr::V4(std::net::Ipv4Addr::new(0,0,0,0))));
            }
        }

        
        for _ in 0..3 {
            for (socket, ip) in &sockets {
                
                let _ = socket.send_to(&msg_bytes, "255.255.255.255:8389");
                
                
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


pub fn start_discovery_listener(
    app_state: std::sync::Arc<parking_lot::RwLock<crate::state::AppState>>,
    _app_handle: tauri::AppHandle,
) {
    std::thread::spawn(move || {
        let socket = match std::net::UdpSocket::bind("0.0.0.0:8389") {
            Ok(s) => s,
            Err(_) => {
                
                
                return;
            }
        };

        let mut buf = [0u8; 1024];
        loop {
            match socket.recv_from(&mut buf) {
                Ok((amt, src)) => {
                    let msg = String::from_utf8_lossy(&buf[..amt]);
                    if msg == "SHAIREE_DISCOVER" {
                        
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
