use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;

#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: u16,
    pub message: String,
}
impl ApiError {
    pub fn new(status: u16, message: impl ToString) -> Self { Self { status, message: message.to_string() } }
}
impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{}", self.message) }
}
impl std::error::Error for ApiError {}
impl From<std::io::Error> for ApiError {
    fn from(_: std::io::Error) -> Self { Self::new(503, "Le stockage local est indisponible.") }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(json!({"ok":false,"error":self.message}))).into_response()
    }
}
