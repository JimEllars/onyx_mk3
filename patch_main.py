import re

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

# Make sure spawn_provider_health_heartbeat is exported from api
# Wait, we need to export it in api/src/lib.rs first
