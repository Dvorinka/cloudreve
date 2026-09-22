use crate::client::{Client, RequestOptions};
use crate::error::ApiResult;
use crate::models::share::*;
use async_trait::async_trait;

/// Share API methods
#[async_trait]
pub trait ShareApi {
    /// Create a share link for a file or folder, returns the share URL.
    async fn create_share(&self, request: &ShareCreateService) -> ApiResult<String>;

    /// Edit an existing share (same payload as create; the URI is still
    /// required because the server treats this as a full upsert).
    async fn update_share(&self, id: &str, request: &ShareCreateService) -> ApiResult<String>;

    /// Delete a share by its (hashid) id.
    async fn delete_share(&self, id: &str) -> ApiResult<()>;
}

#[async_trait]
impl ShareApi for Client {
    async fn create_share(&self, request: &ShareCreateService) -> ApiResult<String> {
        self.put("/share", request, RequestOptions::new()).await
    }

    async fn update_share(&self, id: &str, request: &ShareCreateService) -> ApiResult<String> {
        self.post(&format!("/share/{id}"), request, RequestOptions::new())
            .await
    }

    async fn delete_share(&self, id: &str) -> ApiResult<()> {
        self.delete(&format!("/share/{id}"), RequestOptions::new())
            .await
    }
}
