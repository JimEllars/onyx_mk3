sed -i -e '/let formatted_summary = format_compact_summary(&summary);/a \
    crate::memory::sync_summary_to_cloud(session.id.clone(), summary.clone());' rust/crates/runtime/src/compact.rs
