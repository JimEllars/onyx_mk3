import re
with open("rust/crates/api/src/providers/anthropic.rs", "r") as f:
    c = f.read()

c = c.replace(
'''                            if let Ok(secs) = s.parse::<u64>() {
                                retry_after_duration = Some(Duration::from_secs(secs).min(Duration::from_secs(15)));
                            }''',
'''                            if let Ok(secs) = s.parse::<u64>() {
                                retry_after_duration =
                                    Some(Duration::from_secs(secs).min(Duration::from_secs(15)));
                            }'''
)
c = c.replace(
'''                    Err(error) if error.is_retryable() && attempts <= self.max_retries + 1 => {''',
'''                    Err(error) if error.is_retryable() && attempts <= self.max_retries + 1 => {'''
)
# We will just run cargo fmt directly
with open("rust/crates/api/src/providers/anthropic.rs", "w") as f:
    f.write(c)
