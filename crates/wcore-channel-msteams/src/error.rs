//! `MsTeamsError` — MS Teams-specific error variants.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum MsTeamsError {
    /// OAuth2 token fetch returned a non-2xx status. The raw response body is
    /// deliberately NOT captured: the token POST carries `client_secret`, and
    /// some Azure AD error bodies echo request context, so surfacing the body
    /// (via Debug/Display -> `ChannelError::Other` -> logs) can reflect the
    /// secret. Only the HTTP status is retained.
    #[error("OAuth2 token fetch failed (status {status})")]
    TokenFetch { status: u16 },
    #[error("send failed ({status}): {body}")]
    SendFailed { status: u16, body: String },
    #[error("network: {0}")]
    Network(String),
    #[error("parse: {0}")]
    Parse(String),
    #[error("invalid chat_id format (expected serviceUrl|conversationId)")]
    InvalidChatId,
    /// Inbound JWT validation failed — missing/invalid `Authorization`
    /// header, unknown signing key, or a token that failed signature /
    /// audience / issuer / expiry checks.
    #[error("auth: {0}")]
    Auth(String),
}
