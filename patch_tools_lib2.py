import re

with open('rust/crates/tools/src/lib.rs', 'r') as f:
    content = f.read()

replacement = """                Err(ApiError::RetriesExhausted { attempts, last_error: boxed_error }) if index + 1 < chain.len() => {
                    let err_string = boxed_error.to_string();
                    eprintln!(
                        "provider {} retries exhausted ({err_string}), falling back to secondary",
                        entry.model
                    );
                    last_error = Some(ApiError::RetriesExhausted { attempts, last_error: boxed_error });
                }"""

old_code = """                Err(ApiError::RetriesExhausted { attempts, last_error: boxed_error }) if index + 1 < chain.len() => {
                    let err_string = boxed_error.to_string();
                    eprintln!(
                        "provider {} retries exhausted ({err_string}), falling back to secondary",
                        entry.model
                    );
                    crate::telemetry::emit_telemetry_event(
                        "provider.failover",
                        serde_json::json!({
                            "failed_model": entry.model,
                            "error": err_string,
                            "attempts": attempts,
                            "next_model": chain[index + 1].model
                        }),
                    );
                    last_error = Some(ApiError::RetriesExhausted { attempts, last_error: boxed_error });
                }"""

content = content.replace(old_code, replacement)

with open('rust/crates/tools/src/lib.rs', 'w') as f:
    f.write(content)
