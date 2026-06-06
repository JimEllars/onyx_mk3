pub mod lead_scoring;
pub mod demand_letter;
pub mod nda;
pub mod support_triage;
pub mod billing_fallback;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct WarningMetadata {
    pub missing_fields: Vec<String>,
}
