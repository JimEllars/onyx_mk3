## Description

This Pull Request addresses Sprint 7.9 objectives: Digital Products Persistence & AXiM Core Relay.

It modifies the internal digital product generators (Demand Letter, NDA, and Transcription) to ensure generated assets are durably saved and their completion state is relayed back to the AXiM Core API.

### Changes Made

- **Persistence Integration**:
  - Imported `crate::actions::persistence_manager::PersistenceManager` into `demand_letter.rs`, `nda.rs`, and `transcription.rs`.
  - Added an asynchronous invocation of `PersistenceManager::dual_save(&payload_to_save)` when documents or payloads are successfully generated (`status == "Generated"` or `"Completed"`). This ensures mock documents/JSON are concurrently backed up to Google Drive and Internxt before returning a final URL.
- **AXiM Core Relay Integration**:
  - Imported `crate::actions::axim_core_relay::AximCoreRelayAction` into the digital product generators.
  - Assembled a specialized relay JSON payload post-generation.
  - Implemented an asynchronous call to `AximCoreRelayAction::execute(&relay_payload)` to stream the successful payload parameters and output URLs back to the `AXIM_CORE_API_URL`.
- **Testing & Verification**:
  - Validated that `cargo fmt`, `cargo clippy`, and integration tests continue to pass with the new async pipeline additions.

### Notes for Reviewers
- The `PersistenceManager::dual_save` and `AximCoreRelayAction::execute` functions are designed to log failures rather than hard-panic the main execution flow, preserving the micro-app's availability to the user even if external relays temporarily degrade.
