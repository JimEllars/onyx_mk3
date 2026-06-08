sed -i 's/pub fn load_latest_session/#[allow(dead_code)]\npub fn load_latest_session/g' rust/crates/runtime/src/session_control.rs
