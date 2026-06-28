
pub fn ensure_firewall_rule(port: u16) {
    // Add rule for TCP (file server)
    add_single_firewall_rule(port, "TCP");
    
    // Add rule for UDP (discovery, port 8389)
    add_single_firewall_rule(8389, "UDP");
}

/// Helper to add a single firewall rule for a specific port and protocol
fn add_single_firewall_rule(port: u16, protocol: &str) {
    let rule_name = format!("Shairee File Sharing ({protocol} Port {})", port);

    // Check if rule already exists
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

    // Try to add the rule
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
                // Rule added successfully.
            }
            // If the rule could not be added (e.g. no admin rights), we continue
            // silently — the user can manually allow the port.
            let _ = output.stderr;
        }
        Err(_) => {}
    }
}
