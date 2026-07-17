use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SocialPost {
    pub platform: String,
    pub content: String,
    pub tags: Vec<String>,
    pub media_urls: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnalyticalReport {
    pub title: String,
    pub summary: String,
    pub metrics: std::collections::HashMap<String, f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelemetryLog {
    pub event_type: String,
    pub timestamp: String,
    pub payload: Value,
}

#[derive(Debug)]
pub enum SchemaValidationResult<T> {
    Valid(T),
    Invalid(serde_json::Error),
}

#[must_use]
pub fn validate_json<T: serde::de::DeserializeOwned>(raw_json: &str) -> SchemaValidationResult<T> {
    match serde_json::from_str::<T>(raw_json) {
        Ok(parsed) => SchemaValidationResult::Valid(parsed),
        Err(e) => SchemaValidationResult::Invalid(e),
    }
}
