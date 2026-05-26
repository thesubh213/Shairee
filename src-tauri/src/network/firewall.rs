// src-tauri/src/network/firewall.rs
// Windows Firewall management — best-effort rule creation for LAN access.

/// Attempt to add a Windows Firewall inbound rule for the given port.
/// This is best-effort — if it fails (e.g. no admin rights) we log a warning
/// and continue. The user can manually allow the port.
pub fn ensure_firewall_rule(port: u16) {
    let rule_name = format!("Shairee File Sharing (Port {})", port);

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
                log::info!("Firewall rule already exists: {rule_name}");
                return;
            }
        }
        Err(e) => {
            log::warn!("Could not check firewall rules: {e}");
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
            "protocol=TCP",
            &format!("localport={port}"),
            "profile=private",
            "enable=yes",
        ])
        .output();

    match result {
        Ok(output) => {
            if output.status.success() {
                log::info!("Firewall rule added: {rule_name}");
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log::warn!(
                    "Could not add firewall rule (may need admin): {stderr}"
                );
            }
        }
        Err(e) => {
            log::warn!("Could not run netsh to add firewall rule: {e}");
        }
    }
}
