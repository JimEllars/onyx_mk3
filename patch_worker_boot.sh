sed -i 's/struct StateSnapshot/pub struct StateSnapshot/' rust/crates/runtime/src/worker_boot.rs

awk '/pub struct StateSnapshot/{in_struct=1}
     in_struct && /worker_id:/ { sub("worker_id:", "pub worker_id:"); }
     in_struct && /status:/ { sub("status:", "pub status:"); }
     in_struct && /is_ready:/ { sub("is_ready:", "pub is_ready:"); }
     in_struct && /trust_gate_cleared:/ { sub("trust_gate_cleared:", "pub trust_gate_cleared:"); }
     in_struct && /prompt_in_flight:/ { sub("prompt_in_flight:", "pub prompt_in_flight:"); }
     in_struct && /last_event:/ { sub("last_event:", "pub last_event:"); }
     in_struct && /updated_at:/ { sub("updated_at:", "pub updated_at:"); }
     in_struct && /seconds_since_update:/ { sub("seconds_since_update:", "pub seconds_since_update:"); }
     in_struct && /is_sub_agent:/ { sub("is_sub_agent:", "pub is_sub_agent:"); }
     /^}/ {in_struct=0}
     {print}' rust/crates/runtime/src/worker_boot.rs > temp.rs && mv temp.rs rust/crates/runtime/src/worker_boot.rs
