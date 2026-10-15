use crate::api_specs::webhook_payload::AximWebhookPayload;
use crate::task_packet::TaskPacket;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use tokio::sync::mpsc;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    Standard,
    High,
    Critical,
}

#[derive(Debug, Clone)]
pub struct Dispatcher {
    critical: mpsc::Sender<TaskPacket>,
    high: mpsc::Sender<TaskPacket>,
    standard: mpsc::Sender<TaskPacket>,
    low: mpsc::Sender<TaskPacket>,
}

#[derive(Debug)]
pub struct SwarmQueues {
    pub critical_rx: mpsc::Receiver<TaskPacket>,
    pub high_rx: mpsc::Receiver<TaskPacket>,
    pub standard_rx: mpsc::Receiver<TaskPacket>,
    pub low_rx: mpsc::Receiver<TaskPacket>,
}

impl Dispatcher {
    #[must_use]
    pub fn new(capacity: usize) -> (Self, SwarmQueues) {
        let (critical_tx, critical_rx) = mpsc::channel(capacity);
        let (high_tx, high_rx) = mpsc::channel(capacity);
        let (standard_tx, standard_rx) = mpsc::channel(capacity);
        let (low_tx, low_rx) = mpsc::channel(capacity);

        (
            Self {
                critical: critical_tx,
                high: high_tx,
                standard: standard_tx,
                low: low_tx,
            },
            SwarmQueues {
                critical_rx,
                high_rx,
                standard_rx,
                low_rx,
            },
        )
    }

    pub async fn dispatch(&self, priority: TaskPriority, packet: TaskPacket) -> Result<(), String> {
        let tx = match priority {
            TaskPriority::Critical => &self.critical,
            TaskPriority::High => &self.high,
            TaskPriority::Standard => &self.standard,
            TaskPriority::Low => &self.low,
        };

        tx.send(packet)
            .await
            .map_err(|e| format!("Failed to dispatch task: {e}"))
    }
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait TaskHandler: Send + Sync {
    fn check_idempotency<'a>(
        &'a self,
        payload: &'a AximWebhookPayload,
    ) -> BoxFuture<'a, Result<Option<Value>, String>>;
    fn execute<'a>(
        &'a self,
        payload: &'a AximWebhookPayload,
    ) -> BoxFuture<'a, Result<Value, String>>;
}

pub struct TaskDispatcher {
    handlers: HashMap<String, Box<dyn TaskHandler>>,
}

impl TaskDispatcher {
    #[must_use]
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    pub fn register(&mut self, intent: String, handler: Box<dyn TaskHandler>) {
        self.handlers.insert(intent, handler);
    }

    pub async fn dispatch_webhook(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        if let Some(handler) = self.handlers.get(&payload.intent) {
            if let Ok(Some(cached)) = handler.check_idempotency(payload).await {
                return Ok(cached);
            }
            return handler.execute(payload).await;
        }
        Err(format!(
            "No handler registered for intent: {}",
            payload.intent
        ))
    }
}

impl Default for TaskDispatcher {
    fn default() -> Self {
        Self::new()
    }
}

pub async fn run_swarm_worker<F, Fut>(
    mut queues: SwarmQueues,
    dispatcher: std::sync::Arc<TaskDispatcher>,
    on_success: F,
) where
    F: Fn(Value) -> Fut,
    Fut: Future<Output = ()>,
{
    loop {
        let packet_opt = if let Ok(packet) = queues.critical_rx.try_recv() {
            Some(packet)
        } else if let Ok(packet) = queues.high_rx.try_recv() {
            Some(packet)
        } else if let Ok(packet) = queues.standard_rx.try_recv() {
            Some(packet)
        } else if let Ok(packet) = queues.low_rx.try_recv() {
            Some(packet)
        } else {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            continue;
        };

        if let Some(packet) = packet_opt {
            let payload: Result<AximWebhookPayload, _> = serde_json::from_str(&packet.context);
            if let Ok(payload) = payload {
                let result = dispatcher.dispatch_webhook(&payload).await;
                if let Ok(value) = result {
                    on_success(value).await;
                }
            }
        }
    }
}
