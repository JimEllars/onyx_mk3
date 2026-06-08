# Learnings

## Support Triage
* Need to enforce `must_use` manually inside module functions to ensure compliance with strict `clippy` checks.
* `serde_json::Value` offers great mutability via `.as_object_mut()` and `.as_array_mut()` to recursively scan and mask private keys for complex dynamic JSON payloads dynamically.
