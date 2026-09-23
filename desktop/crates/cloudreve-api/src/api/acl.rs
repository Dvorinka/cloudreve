use crate::client::{Client, RequestOptions};
use crate::error::ApiResult;
use crate::models::acl::*;
use async_trait::async_trait;

/// Per-file ACL ("selected users and groups") endpoints.
#[async_trait]
pub trait AclApi {
    /// List ACL entries on a file.
    async fn list_acl(&self, uri: &str) -> ApiResult<Vec<AclEntry>>;

    /// Search selectable subjects: exact-match users by email plus
    /// fuzzy-match groups. Anonymous/everyone are client-side constants.
    async fn search_acl_subjects(&self, keyword: &str) -> ApiResult<Vec<AclSubject>>;

    /// Create or update an ACL entry for (file, subject).
    async fn upsert_acl(&self, request: &AclUpsertService) -> ApiResult<AclEntry>;

    /// Remove an ACL entry by id.
    async fn delete_acl(&self, uri: &str, id: i64) -> ApiResult<()>;
}

#[async_trait]
impl AclApi for Client {
    async fn list_acl(&self, uri: &str) -> ApiResult<Vec<AclEntry>> {
        let query = format!("?uri={}", urlencoding::encode(uri));
        self.get(&format!("/file/acl{query}"), RequestOptions::new())
            .await
    }

    async fn search_acl_subjects(&self, keyword: &str) -> ApiResult<Vec<AclSubject>> {
        let query = format!("?keyword={}", urlencoding::encode(keyword));
        self.get(
            &format!("/file/acl/subjects{query}"),
            RequestOptions::new(),
        )
        .await
    }

    async fn upsert_acl(&self, request: &AclUpsertService) -> ApiResult<AclEntry> {
        self.put("/file/acl", request, RequestOptions::new()).await
    }

    async fn delete_acl(&self, uri: &str, id: i64) -> ApiResult<()> {
        let query = format!("?uri={}&id={id}", urlencoding::encode(uri));
        self.delete(&format!("/file/acl{query}"), RequestOptions::new())
            .await
    }
}
