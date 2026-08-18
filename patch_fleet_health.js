const fs = require('fs');
const path = 'rust/crates/runtime/src/fleet_health.rs';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  'pub fn evaluate_fleet_health(status: &GlobalFleetStatus, telemetry_logs: &serde_json::Value) {',
  '#[allow(clippy::too_many_lines)]\npub fn evaluate_fleet_health(status: &GlobalFleetStatus, telemetry_logs: &serde_json::Value) {'
);

fs.writeFileSync(path, code);
