use crate::persona::BrandId;
use std::collections::{HashMap, VecDeque};
use std::sync::{OnceLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_SNAPSHOTS_PER_BRAND: usize = 42; // Example bounded cache size
pub const MAX_RETRIEVAL_LIMIT: usize = 5;

#[derive(Debug, Clone)]
pub struct MemorySnapshot {
    pub content: String,
    pub timestamp_ms: u64,
}

pub struct VectorMemory {
    store: HashMap<BrandId, VecDeque<MemorySnapshot>>,
}

impl VectorMemory {
    fn new() -> Self {
        Self {
            store: HashMap::new(),
        }
    }

    pub fn store_snapshot(&mut self, tenant_id: &BrandId, content: String) {
        #[allow(clippy::cast_possible_truncation)]
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let snapshot = MemorySnapshot {
            content,
            timestamp_ms,
        };

        let deque = self.store.entry(tenant_id.clone()).or_default();
        deque.push_back(snapshot);

        // Enforce bounded cache LRU-style by popping the front (oldest) if over limit
        if deque.len() > MAX_SNAPSHOTS_PER_BRAND {
            deque.pop_front();
        }
    }

    #[must_use]
    pub fn get_recent_context(&self, tenant_id: &BrandId, limit: usize) -> Vec<MemorySnapshot> {
        if let Some(deque) = self.store.get(tenant_id) {
            let actual_limit = limit.min(MAX_RETRIEVAL_LIMIT).min(deque.len());
            // Get the newest items (at the back of the deque)
            let skip_count = deque.len() - actual_limit;
            deque.iter().skip(skip_count).cloned().collect()
        } else {
            Vec::new()
        }
    }

    #[must_use]
    pub fn get_memory_count(&self, tenant_id: &BrandId) -> usize {
        self.store
            .get(tenant_id)
            .map_or(0, std::collections::VecDeque::len)
    }
}

pub fn global_memory() -> &'static RwLock<VectorMemory> {
    static MEMORY: OnceLock<RwLock<VectorMemory>> = OnceLock::new();
    MEMORY.get_or_init(|| RwLock::new(VectorMemory::new()))
}
