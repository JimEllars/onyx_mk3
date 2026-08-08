import re

with open("rust/crates/api/src/lib.rs", "r") as f:
    content = f.read()

content = content.replace("resolve_model_alias, ProviderKind", "resolve_model_alias, ProviderKind, spawn_provider_health_heartbeat")

with open("rust/crates/api/src/lib.rs", "w") as f:
    f.write(content)
