cat << 'INNER_EOF' > process_app.py
import re

with open("rust/crates/onyx/src/app.rs", "r") as f:
    content = f.read()

content = re.sub(
    r'telemetry::metrics::enqueue_metric_event\(telemetry::metrics::MetricEvent::TuiResize\("window"\.to_string\(\)\)\);\/\/telemetry::metrics::TUI_RESIZE_EVENTS_TOTAL\n\s*\.with_label_values\(&\["too_small"\]\)\n\s*\.inc\(\);',
    r'telemetry::metrics::enqueue_metric_event(telemetry::metrics::MetricEvent::TuiResize("too_small".to_string()));',
    content
)

content = re.sub(
    r'telemetry::metrics::enqueue_metric_event\(telemetry::metrics::MetricEvent::TuiResize\("window"\.to_string\(\)\)\);\/\/telemetry::metrics::TUI_RESIZE_EVENTS_TOTAL\n\s*\.with_label_values\(&\["resize"\]\)\n\s*\.inc\(\);',
    r'telemetry::metrics::enqueue_metric_event(telemetry::metrics::MetricEvent::TuiResize("resize".to_string()));',
    content
)

with open("rust/crates/onyx/src/app.rs", "w") as f:
    f.write(content)
INNER_EOF
python3 process_app.py
