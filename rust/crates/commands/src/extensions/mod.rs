pub mod lead_scoring;
pub mod demand_letter;
pub mod nda;
pub mod support_triage;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct WarningMetadata {
    pub missing_fields: Vec<String>,
}
