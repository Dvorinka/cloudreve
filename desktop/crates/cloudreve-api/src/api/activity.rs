use crate::client::{Client, RequestOptions};
use crate::error::ApiResult;
use crate::models::activity::FileActivityResponse;
use async_trait::async_trait;

/// Owner-scoped audit feed (`GET /file/activity`).
#[async_trait]
pub trait ActivityApi {
    /// List audit events for a file. `share_id` optionally narrows the feed
    /// to events of one share — the share-history view.
    async fn list_file_activity(
        &self,
        uri: &str,
        page: u32,
        page_size: u32,
        share_id: Option<&str>,
    ) -> ApiResult<FileActivityResponse>;
}

#[async_trait]
impl ActivityApi for Client {
    async fn list_file_activity(
        &self,
        uri: &str,
        page: u32,
        page_size: u32,
        share_id: Option<&str>,
    ) -> ApiResult<FileActivityResponse> {
        let mut query = format!(
            "?uri={}&page={page}&page_size={page_size}",
            urlencoding::encode(uri)
        );
        if let Some(sid) = share_id {
            query.push_str(&format!("&share_id={}", urlencoding::encode(sid)));
        }
        self.get(&format!("/file/activity{query}"), RequestOptions::new())
            .await
    }
}
