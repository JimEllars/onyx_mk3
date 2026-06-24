import re
import sys

def patch():
    with open("rust/crates/onyx/src/main.rs", "r") as f:
        content = f.read()

    replacement = """
        if let Some(sink) = telemetry::supabase::SupabaseTelemetrySink::new() {
            let sink_arc = std::sync::Arc::new(sink);
            tokio::spawn(async move {
                telemetry::dlq::start_dlq_drain_loop(sink_arc).await;
            });
        }
"""

    start_idx = content.find("        let fleet_status_telemetry = fleet_status.clone();")

    if start_idx == -1:
        print("Function not found!")
        sys.exit(1)

    new_content = content[:start_idx] + replacement.strip() + "\n\n        " + content[start_idx:]

    with open("rust/crates/onyx/src/main.rs", "w") as f:
        f.write(new_content)

patch()
