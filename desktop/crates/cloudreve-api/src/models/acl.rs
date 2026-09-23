use serde::{Deserialize, Serialize};

/// One row in the file's permission list — a user, group, anonymous or
/// everyone grant with a named-permission set.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AclEntry {
    pub id: i64,
    pub subject_type: String,
    pub subject_id: i64,
    #[serde(default)]
    pub subject_name: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

/// A selectable subject returned by the subjects search endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclSubject {
    #[serde(rename = "type")]
    pub subject_type: String,
    pub id: i64,
    pub name: String,
}

/// Upsert payload for `PUT /file/acl`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclUpsertService {
    pub uri: String,
    pub subject_type: String,
    #[serde(default)]
    pub subject_id: i64,
    pub permissions: Vec<String>,
}
