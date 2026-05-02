with open("rust/crates/runtime/src/worker_boot.rs", "r") as f:
    lines = f.readlines()

new_lines = []
in_snapshot = False

swarm_snapshot_code = """
#[derive(serde::Serialize)]
pub struct SwarmSnapshot<'a> {
    pub active_workers: Vec<StateSnapshot<'a>>,
    pub timestamp: u64,
}

pub fn persist_swarm_state(registry: &WorkerRegistry) -> std::io::Result<()> {
    let now = now_secs();

    let state_dir = std::path::Path::new(".claw");
    if std::fs::create_dir_all(&state_dir).is_err() {
        return Ok(());
    }

    let inner = registry.inner.lock().unwrap();
    let mut active_workers = Vec::new();

    for worker in inner.workers.values() {
        active_workers.push(StateSnapshot {
            worker_id: &worker.worker_id,
            status: worker.status,
            is_ready: worker.status == WorkerStatus::ReadyForPrompt,
            trust_gate_cleared: worker.trust_gate_cleared,
            prompt_in_flight: worker.prompt_in_flight,
            last_event: worker.events.last(),
            updated_at: worker.updated_at,
            seconds_since_update: now.saturating_sub(worker.updated_at),
            is_sub_agent: std::env::var("ONYX_IS_SUB_AGENT").unwrap_or_else(|_| "false".to_string()) == "true",
        });
    }

    let snapshot = SwarmSnapshot {
        active_workers,
        timestamp: now,
    };

    let state_path = state_dir.join("swarm-state.json");
    let tmp_path = state_dir.join("swarm-state.json.tmp");

    if let Ok(json) = serde_json::to_string_pretty(&snapshot) {
        let _ = std::fs::write(&tmp_path, &json);
        let _ = std::fs::rename(&tmp_path, &state_path);
    }

    Ok(())
}
"""

for line in lines:
    if line.startswith("struct StateSnapshot<'a> {"):
        new_lines.append("pub struct StateSnapshot<'a> {\n")
        in_snapshot = True
        continue

    if in_snapshot:
        if line.startswith("}"):
            in_snapshot = False
            new_lines.append(line)
        else:
            if not line.strip().startswith("///") and line.strip() != "":
                if "pub " not in line:
                    new_lines.append(line.replace("    ", "    pub ", 1))
                else:
                    new_lines.append(line)
            else:
                new_lines.append(line)
    elif line.startswith("fn emit_state_file(worker: &Worker) {"):
        new_lines.append(swarm_snapshot_code)
        new_lines.append(line)
    else:
        new_lines.append(line)

with open("rust/crates/runtime/src/worker_boot.rs", "w") as f:
    f.write("".join(new_lines))
