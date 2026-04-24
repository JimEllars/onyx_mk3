import sys

content = open("rust/crates/runtime/src/lane_events.rs").read()
content = content.replace("pub fn handle_telemetry_event(event: TelemetryEvent)", "pub fn handle_telemetry_event(event: &TelemetryEvent)")
with open("rust/crates/runtime/src/lane_events.rs", "w") as f:
    f.write(content)
