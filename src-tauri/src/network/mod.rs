// src-tauri/src/network/mod.rs
// Network detection and management.

pub mod discovery;
pub mod firewall;

pub use discovery::{get_all_local_ips, get_primary_local_ip};
pub use firewall::ensure_firewall_rule;
