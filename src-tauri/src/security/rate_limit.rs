// src-tauri/src/security/rate_limit.rs
// Per-IP PIN attempt rate limiting to prevent brute-force attacks.

use std::collections::HashMap;
use std::time::Instant;

/// Tracks failed authentication attempts for a single IP.
#[derive(Debug)]
struct AttemptTracker {
    count: u32,
    first_attempt: Instant,
    blocked_until: Option<Instant>,
}

impl AttemptTracker {
    fn new() -> Self {
        Self {
            count: 0,
            first_attempt: Instant::now(),
            blocked_until: None,
        }
    }

    /// Record a failed attempt. Returns true if the IP is now blocked.
    fn record_failure(&mut self, max_attempts: u32, block_duration: std::time::Duration) -> bool {
        self.count += 1;

        // If we've exceeded the threshold, block the IP
        if self.count >= max_attempts {
            self.blocked_until = Some(Instant::now() + block_duration);
            return true;
        }
        false
    }

    /// Check if the IP is currently blocked. Also resets the window if enough time has passed.
    fn is_blocked(&mut self, window: std::time::Duration) -> bool {
        let now = Instant::now();

        // If blocked, check if the block has expired
        if let Some(blocked_until) = self.blocked_until {
            if now < blocked_until {
                return true;
            }
            // Block expired — full reset
            self.count = 0;
            self.first_attempt = now;
            self.blocked_until = None;
            return false;
        }

        // Reset sliding window if expired
        if now.duration_since(self.first_attempt) > window {
            self.count = 0;
            self.first_attempt = now;
        }

        false
    }
}

/// Per-IP rate limiter for authentication attempts.
#[derive(Debug)]
pub struct AuthRateLimiter {
    trackers: HashMap<String, AttemptTracker>,
    max_attempts: u32,
    window: std::time::Duration,
    block_duration: std::time::Duration,
}

impl AuthRateLimiter {
    /// Create a new rate limiter.
    /// - `max_attempts`: number of failures before blocking (default: 5)
    /// - `window`: time window for counting attempts (default: 60s)
    /// - `block_duration`: how long to block after exceeding max_attempts (default: 5min)
    pub fn new(
        max_attempts: u32,
        window: std::time::Duration,
        block_duration: std::time::Duration,
    ) -> Self {
        Self {
            trackers: HashMap::new(),
            max_attempts,
            window,
            block_duration,
        }
    }

    /// Check if an IP is allowed to attempt authentication.
    /// If blocked, returns Err with the remaining block time in seconds.
    /// If allowed, records a failed attempt and returns Ok(false).
    pub fn check_and_record_failure(&mut self, ip: &str) -> Result<bool, u64> {
        let tracker = self.trackers.entry(ip.to_string()).or_insert_with(AttemptTracker::new);

        if tracker.is_blocked(self.window) {
            let remaining = tracker.blocked_until
                .map(|until| until.duration_since(Instant::now()).as_secs())
                .unwrap_or(0);
            return Err(remaining.max(1));
        }

        let now_blocked = tracker.record_failure(self.max_attempts, self.block_duration);
        Ok(now_blocked)
    }

    /// Reset the failure counter for an IP (e.g., on successful auth).
    pub fn reset(&mut self, ip: &str) {
        self.trackers.remove(ip);
    }

    /// Prune stale entries to prevent unbounded memory growth.
    pub fn prune(&mut self) {
        let window = self.window;
        let now = Instant::now();
        self.trackers.retain(|_, tracker| {
            // Keep if blocked and block hasn't expired
            if let Some(until) = tracker.blocked_until {
                return now < until;
            }
            // Keep if within the counting window
            now.duration_since(tracker.first_attempt) <= window
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_allows_initial_attempts() {
        let mut limiter = AuthRateLimiter::new(3, Duration::from_secs(60), Duration::from_secs(5));
        // First 2 attempts should be allowed (not yet at max_attempts=3)
        assert!(limiter.check_and_record_failure("1.2.3.4").is_ok());
        assert!(limiter.check_and_record_failure("1.2.3.4").is_ok());
    }

    #[test]
    fn test_blocks_after_threshold() {
        let mut limiter = AuthRateLimiter::new(3, Duration::from_secs(60), Duration::from_secs(5));
        limiter.check_and_record_failure("1.2.3.4").unwrap();
        limiter.check_and_record_failure("1.2.3.4").unwrap();
        // Third attempt hits the threshold and blocks
        assert!(limiter.check_and_record_failure("1.2.3.4").is_ok()); // still returns Ok(true)
        // Subsequent attempt should be Err
        assert!(limiter.check_and_record_failure("1.2.3.4").is_err());
    }

    #[test]
    fn test_independent_ips() {
        let mut limiter = AuthRateLimiter::new(2, Duration::from_secs(60), Duration::from_secs(5));
        assert!(limiter.check_and_record_failure("1.1.1.1").is_ok());
        assert!(limiter.check_and_record_failure("1.1.1.1").is_ok());
        assert!(limiter.check_and_record_failure("1.1.1.1").is_err()); // blocked
        assert!(limiter.check_and_record_failure("2.2.2.2").is_ok()); // independent
    }

    #[test]
    fn test_reset_on_success() {
        let mut limiter = AuthRateLimiter::new(2, Duration::from_secs(60), Duration::from_secs(5));
        limiter.check_and_record_failure("1.1.1.1").unwrap();
        limiter.reset("1.1.1.1");
        // After reset, should be allowed again
        assert!(limiter.check_and_record_failure("1.1.1.1").is_ok());
        assert!(limiter.check_and_record_failure("1.1.1.1").is_ok());
    }
}
