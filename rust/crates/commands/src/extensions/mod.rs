pub mod billing_fallback;
pub mod contact_scraper;
pub mod demand_letter;
pub mod lead_scoring;
pub mod nda;
pub mod pay_stub;
pub mod prospect_research;
pub mod smart_contract;
pub mod support_triage;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct WarningMetadata {
    pub missing_fields: Vec<String>,
}
pub mod autonomous_orchestrator;
pub mod transcription;
