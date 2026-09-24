use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// One row in the owner-scoped audit feed (`GET /file/activity`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: i64,
    #[serde(default)]
    pub actor_id: Option<String>,
    #[serde(default)]
    pub actor_name: Option<String>,
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub file_id: Option<String>,
    #[serde(default)]
    pub share_id: Option<String>,
    #[serde(default)]
    pub extra: Option<HashMap<String, serde_json::Value>>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FileActivityResponse {
    pub events: Vec<ActivityEvent>,
    pub total: i64,
}
