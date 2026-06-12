# Phase 23 Learnings

- OnceLock with tokio handlers provides an effective decoupled approach to connect runtime generic systems to tools modules without creating direct circular crate dependencies.
- It is vital to decouple predictive_ops to operate purely on telemetry metric fetching without blocking the main event loops.
