cat << 'INNER_EOF' > patch4.diff
<<<<<<< SEARCH
// Distributed Cache Invalidation Hook
pub static PROMPT_CACHE_INVALIDATOR: OnceLock<tokio::sync::broadcast::Sender<()>> = OnceLock::new();

pub fn init_prompt_cache_invalidator() -> tokio::sync::broadcast::Receiver<()> {
    let (tx, rx) = tokio::sync::broadcast::channel(16);
    PROMPT_CACHE_INVALIDATOR.set(tx).unwrap_or_default();
    rx
}

pub fn trigger_prompt_cache_invalidation() {
    if let Some(tx) = PROMPT_CACHE_INVALIDATOR.get() {
        let _ = tx.send(());
    }
}
=======
// Distributed Cache Invalidation Hook
#[allow(dead_code)]
pub static PROMPT_CACHE_INVALIDATOR: OnceLock<tokio::sync::broadcast::Sender<()>> = OnceLock::new();

#[allow(dead_code)]
pub fn init_prompt_cache_invalidator() -> tokio::sync::broadcast::Receiver<()> {
    let (tx, rx) = tokio::sync::broadcast::channel(16);
    PROMPT_CACHE_INVALIDATOR.set(tx).unwrap_or_default();
    rx
}

#[allow(dead_code)]
pub fn trigger_prompt_cache_invalidation() {
    if let Some(tx) = PROMPT_CACHE_INVALIDATOR.get() {
        let _ = tx.send(());
    }
}
>>>>>>> REPLACE
INNER_EOF
