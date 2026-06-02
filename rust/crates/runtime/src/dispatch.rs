use crate::task_packet::TaskPacket;
use serde::{Deserialize, Serialize};
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

        tx.send(packet).await.map_err(|e| format!("Failed to dispatch task: {e}"))
    }
}
