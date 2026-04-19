import re

with open("rust/crates/runtime/src/team_cron_registry.rs", "r") as f:
    content = f.read()

target = """pub fn start_background_tick_loop(
    cron_registry: Arc<CronRegistry>,
    fleet_status: GlobalFleetStatus,
) {"""

replacement = """pub fn start_background_tick_loop(
    cron_registry: Arc<CronRegistry>,
    fleet_status: GlobalFleetStatus,
) -> tokio::task::JoinHandle<()> {"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/team_cron_registry.rs", "w") as f:
        f.write(content)
    print("Replaced tick loop")
