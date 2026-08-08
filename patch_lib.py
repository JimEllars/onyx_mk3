import re

with open("rust/crates/api/src/lib.rs", "r") as f:
    content = f.read()

# Add spawn_provider_health_heartbeat to exports from providers
content = content.replace("ProviderKind, resolve_model_alias,", "ProviderKind, resolve_model_alias, spawn_provider_health_heartbeat,")

with open("rust/crates/api/src/lib.rs", "w") as f:
    f.write(content)
