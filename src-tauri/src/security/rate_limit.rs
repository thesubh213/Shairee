


use std::collections::HashMap;
use std::time::Instant;


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

    
    fn record_failure(&mut self, max_attempts: u32, block_duration: std::time::Duration) -> bool {
        self.count += 1;

        
        if self.count >= max_attempts {
            self.blocked_until = Some(Instant::now() + block_duration);
            return true;
        }
        false
    }

    
    fn is_blocked(&mut self, window: std::time::Duration) -> bool {
        let now = Instant::now();

        
        if let Some(blocked_until) = self.blocked_until {
            if now < blocked_until {
                return true;
            }
            
            self.count = 0;
            self.first_attempt = now;
            self.blocked_until = None;
            return false;
        }

        
        if now.duration_since(self.first_attempt) > window {
            self.count = 0;
            self.first_attempt = now;
        }

        false
    }
}


#[derive(Debug)]
pub struct AuthRateLimiter {
    trackers: HashMap<String, AttemptTracker>,
    max_attempts: u32,
    window: std::time::Duration,
    block_duration: std::time::Duration,
}

impl AuthRateLimiter {
    
    
    
    
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

    
    pub fn reset(&mut self, ip: &str) {
        self.trackers.remove(ip);
    }

    
    pub fn prune(&mut self) {
        let window = self.window;
        let now = Instant::now();
        self.trackers.retain(|_, tracker| {
            
            if let Some(until) = tracker.blocked_until {
                return now < until;
            }
            
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
        
        assert!(limiter.check_and_record_failure("1.2.3.4").is_ok());
        assert!(limiter.check_and_record_failure("1.2.3.4").is_ok());
    }

    #[test]
    fn test_blocks_after_threshold() {
        let mut limiter = AuthRateLimiter::new(3, Duration::from_secs(60), Duration::from_secs(5));
        limiter.check_and_record_failure("1.2.3.4").unwrap();
        limiter.check_and_record_failure("1.2.3.4").unwrap();
        
        assert!(limiter.check_and_record_failure("1.2.3.4").is_ok()); 
        
        assert!(limiter.check_and_record_failure("1.2.3.4").is_err());
    }

    #[test]
    fn test_independent_ips() {
        let mut limiter = AuthRateLimiter::new(2, Duration::from_secs(60), Duration::from_secs(5));
        assert!(limiter.check_and_record_failure("1.1.1.1").is_ok());
        assert!(limiter.check_and_record_failure("1.1.1.1").is_ok());
        assert!(limiter.check_and_record_failure("1.1.1.1").is_err()); 
        assert!(limiter.check_and_record_failure("2.2.2.2").is_ok()); 
    }

    #[test]
    fn test_reset_on_success() {
        let mut limiter = AuthRateLimiter::new(2, Duration::from_secs(60), Duration::from_secs(5));
        limiter.check_and_record_failure("1.1.1.1").unwrap();
        limiter.reset("1.1.1.1");
        
        assert!(limiter.check_and_record_failure("1.1.1.1").is_ok());
        assert!(limiter.check_and_record_failure("1.1.1.1").is_ok());
    }
}
