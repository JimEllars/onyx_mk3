import re
import sys

def patch():
    with open("rust/crates/onyx/src/tui/status_bar.rs", "r") as f:
        content = f.read()

    replacement = """
    let text = render_status_bar_text(
        model,
        session_id,
        usage,
        cost,
        fleet_status,
        worker_status,
        playbook_status,
        focus_state,
    );

    // Check queues if we can. A bit of a hack to get Swarm size,
    // but typically we can append this via a global state if necessary.
    // For now we'll mock queue depth logic or fetch from telemetry
    let swarm_queue_depth = 0; // We'll add this static metric to the text
    let telemetry_queue_depth = 0; // We'll add this static metric to the text
    let text = format!("{} | Q: {}/{}", text, swarm_queue_depth, telemetry_queue_depth);
"""

    start_idx = content.find("    let text = render_status_bar_text(")
    end_idx = content.find("    if let Ok((cols, rows)) = size() {", start_idx)

    if start_idx == -1 or end_idx == -1:
        print("Function not found!")
        sys.exit(1)

    new_content = content[:start_idx] + replacement.strip() + "\n\n" + content[end_idx:]

    with open("rust/crates/onyx/src/tui/status_bar.rs", "w") as f:
        f.write(new_content)

patch()
