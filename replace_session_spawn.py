import re

with open("rust/crates/runtime/src/session_control.rs", "r") as f:
    content = f.read()

target = """pub fn start_session_background_loop(store: SessionStore, cron_registry: std::sync::Arc<crate::team_cron_registry::CronRegistry>) {
    // Scaffold implementation for the background loop linking session and cron
    tokio::spawn(async move {"""

replacement = """pub fn start_session_background_loop(store: SessionStore, cron_registry: std::sync::Arc<crate::team_cron_registry::CronRegistry>) -> tokio::task::JoinHandle<()> {
    // Scaffold implementation for the background loop linking session and cron
    tokio::spawn(async move {"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/session_control.rs", "w") as f:
        f.write(content)
    print("Replaced session spawn")
