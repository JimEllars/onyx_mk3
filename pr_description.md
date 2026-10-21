## Sprint 7.9: Digital Products Persistence & AXiM Core Relay

### Description
This PR integrates the `PersistenceManager` and `AximCoreRelayAction` into the digital product generator extensions (`demand_letter`, `nda`, and `transcription`) to ensure that generated assets are reliably persisted and tracked via the centralized AXiM Core API.

### Changes Made
- **Demand Letter Generator (`rust/crates/commands/src/extensions/demand_letter.rs`)**:
  - Imported `PersistenceManager` and `AximCoreRelayAction`.
  - Added asynchronous call to `PersistenceManager::dual_save()` upon successful document generation.
  - Added asynchronous call to `AximCoreRelayAction::execute()` to relay the generated status, URL, and input parameters to the AXiM core.
- **NDA Generator (`rust/crates/commands/src/extensions/nda.rs`)**:
  - Imported `PersistenceManager` and `AximCoreRelayAction`.
  - Added asynchronous call to `PersistenceManager::dual_save()` upon successful document generation.
  - Added asynchronous call to `AximCoreRelayAction::execute()` to relay the generated status, URL, and input parameters to the AXiM core.
- **Transcription Generator (`rust/crates/commands/src/extensions/transcription.rs`)**:
  - Imported `PersistenceManager` and `AximCoreRelayAction`.
  - Added asynchronous call to `PersistenceManager::dual_save()` upon successful transcription.
  - Added asynchronous call to `AximCoreRelayAction::execute()` to relay the generated status, transcript, and input parameters to the AXiM core.

### Future Development Plan (App Review)
- **Centralized Billing / Stripe Integration**: The edge workers handling Stripe checkouts should be tightly coupled with the `AximCoreRelayAction` to securely emit post-payment artifacts to AXiM Core.
- **Improved Transcription Mocks/API Integration**: The `transcription.rs` generator currently mocks Noota. This should be swapped to call real APIs once endpoints are fully provisioned, keeping costs managed and monitored.
- **Idempotency Flow**: Better implement `idempotency_key` caching to instantly return URLs for assets generated previously without reprocessing templates.
- **Agent Action Subsystem**: Integrate Claude Cowork or Google Spark to manually review formatting if a generated document fails template validations in the future.
