with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

content = content.replace(
    "runtime::fleet_health::evaluate_fleet_health(&fleet_status_telemetry, &output.logs);",
    "runtime::fleet_health::evaluate_health_with_ai(&fleet_status_telemetry, &output.logs).await;"
)

with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)
print("done")
