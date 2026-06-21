import re

with open("rust/crates/onyx/src/init.rs", "r") as f:
    content = f.read()

content = re.sub(
    r'eprintln\!\("WARNING: Required EmailIt transaction variables \(e.g. EMAILIT_API_KEY or AXIM_SERVICE_KEY\) are absent from the environment. Communication channels may be degraded."\);',
    r'eprintln!("WARNING: Required EmailIt transaction variables (e.g. EMAILIT_API_KEY or AXIM_SERVICE_KEY) are absent from the environment. Communication channels may be degraded.");\n        telemetry::metrics::enqueue_metric_event(telemetry::metrics::MetricEvent::TuiResize("init_missing_creds".to_string()));',
    content
)

with open("rust/crates/onyx/src/init.rs", "w") as f:
    f.write(content)
