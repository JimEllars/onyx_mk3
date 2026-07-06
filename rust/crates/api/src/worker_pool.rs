use std::future::Future;
use std::pin::Pin;
use telemetry::metrics::{increment_worker_processed, set_worker_queue_depth};
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TrySendError;

type Job = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;

pub struct WorkerPool {
    sender: mpsc::Sender<Job>,
}

impl WorkerPool {
    #[must_use]
    pub fn new(capacity: usize, workers: usize) -> Self {
        let (sender, receiver) = mpsc::channel::<Job>(capacity);

        let receiver = std::sync::Arc::new(tokio::sync::Mutex::new(receiver));

        for _ in 0..workers {
            let rx = receiver.clone();
            tokio::spawn(async move {
                loop {
                    let job_opt = {
                        let mut rx_lock = rx.lock().await;
                        rx_lock.recv().await
                    };

                    if let Some(job) = job_opt {
                        // We received a job, execute it
                        job.await;
                        increment_worker_processed();
                    } else {
                        break;
                    }
                }
            });
        }

        Self { sender }
    }

    pub fn spawn<F>(&self, future: F) -> Result<(), &'static str>
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let job: Job = Box::pin(future);
        match self.sender.try_send(job) {
            Ok(()) => {
                // Approximate capacity metric can be derived from bounded channels if needed, but tokio doesn't expose active count natively on Sender without capacity().
                // We'll update the queue depth in the caller or using capacity
                set_worker_queue_depth(self.sender.capacity());
                Ok(())
            }
            Err(TrySendError::Full(_)) => Err("Worker pool is at capacity (backpressure)"),
            Err(TrySendError::Closed(_)) => Err("Worker pool is closed"),
        }
    }
}
