sed -i 's/send_with_retry/send_with_circuit_breaker/g' rust/crates/tools/src/support_ops.rs
sed -i 's/send_with_retry/send_with_circuit_breaker/g' rust/crates/tools/src/swarm_ops.rs
sed -i 's/send_with_retry/send_with_circuit_breaker/g' rust/crates/tools/src/axim_ops.rs
sed -i 's/send_with_retry/send_with_circuit_breaker/g' rust/crates/tools/src/http_client.rs
sed -i 's/send_with_circuit_breaker/send_with_retry/g' rust/crates/tools/src/http_client.rs
