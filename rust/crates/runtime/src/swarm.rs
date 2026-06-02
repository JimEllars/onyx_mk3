use crate::dispatch::SwarmQueues;
use std::time::Duration;
use tokio::time::sleep;

#[derive(Debug)]
pub struct SwarmWorker {
    queues: SwarmQueues,
}

impl SwarmWorker {
    #[must_use]
    pub fn new(queues: SwarmQueues) -> Self {
        Self { queues }
    }

    pub async fn run(mut self) {
        loop {
            // Drain critical queue first
            while self.queues.critical_rx.try_recv().is_ok() {
                self.process_packet("Critical").await;
            }

            // If critical queue is empty, try high
            if self.queues.high_rx.try_recv().is_ok() {
                self.process_packet("High").await;
                continue; // Re-evaluate critical queue
            }

            // If high is empty, try standard
            if self.queues.standard_rx.try_recv().is_ok() {
                self.process_packet("Standard").await;
                continue; // Re-evaluate critical queue
            }

            // If standard is empty, try low
            if self.queues.low_rx.try_recv().is_ok() {
                self.process_packet("Low").await;
                continue; // Re-evaluate critical queue
            }

            // If all queues are empty, wait for an item or sleep
            tokio::select! {
                Some(_) = self.queues.critical_rx.recv() => {
                    self.process_packet("Critical").await;
                }
                Some(_) = self.queues.high_rx.recv() => {
                    self.process_packet("High").await;
                }
                Some(_) = self.queues.standard_rx.recv() => {
                    self.process_packet("Standard").await;
                }
                Some(_) = self.queues.low_rx.recv() => {
                    self.process_packet("Low").await;
                }
            }
        }
    }

    async fn process_packet(&self, priority: &str) {
        println!("[Swarm Worker] Processing {priority} priority task");
        // Simulate some work
        // In reality, this would execute the playbook or pass to the consensus engine
        sleep(Duration::from_millis(10)).await;
        println!("[Swarm Worker] Finished {priority} priority task");
    }
}
