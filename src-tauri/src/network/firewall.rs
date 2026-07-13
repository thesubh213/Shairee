
pub fn ensure_firewall_rule(port: u16) {
    
    add_single_firewall_rule(port, "TCP");
    
    
    add_single_firewall_rule(8389, "UDP");
}


fn add_single_firewall_rule(port: u16, protocol: &str) {
    let rule_name = format!("Shairee File Sharing ({protocol} Port {})", port);

    
    let check = std::process::Command::new("netsh")
        .args([
            "advfirewall", "firewall", "show", "rule",
            &format!("name={rule_name}"),
        ])
        .output();

    match check {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.contains(&rule_name) {
                return;
            }
        }
        Err(_) => {
            return;
        }
    }

    
    let result = std::process::Command::new("netsh")
        .args([
            "advfirewall", "firewall", "add", "rule",
            &format!("name={rule_name}"),
            "dir=in",
            "action=allow",
            &format!("protocol={protocol}"),
            &format!("localport={port}"),
            "profile=private,domain",
            "enable=yes",
        ])
        .output();

    match result {
        Ok(output) => {
            if output.status.success() {
                
            }
            
            
            let _ = output.stderr;
        }
        Err(_) => {}
    }
}
