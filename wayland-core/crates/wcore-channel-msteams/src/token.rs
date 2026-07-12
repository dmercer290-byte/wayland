//! Bot Framework OAuth2 client-credentials token cache.
//!
//! The Bot Framework token endpoint issues ~1-hour tokens. We cache
//! and refresh 5 minutes before expiry to avoid per-send latency.

use serde::Deserialize;
use tokio::sync::Mutex;

use crate::error::MsTeamsError;

/// Token endpoint for the Bot Framework multi-tenant common path.
pub const BF_TOKEN_URL: &str =
    "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token";
const BF_TOKEN_SCOPE: &str = "https://api.botframework.com/.default";
const REFRESH_BUFFER_SECS: u64 = 300; // 5 min

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Debug)]
struct CachedToken {
    token: String,
    expires_at_secs: u64,
}

/// Shared, mutex-protected token cache. Clone to share across the channel.
#[derive(Debug, Default, Clone)]
pub struct TokenCache {
    inner: std::sync::Arc<Mutex<Option<CachedToken>>>,
}

impl TokenCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Return a valid Bearer token, refreshing if expired or near expiry.
    pub async fn get_token(
        &self,
        http: &wcore_egress::EgressClient,
        app_id: &str,
        app_password: &str,
        token_url: &str,
    ) -> Result<String, MsTeamsError> {
        let now = now_secs();
        {
            let guard = self.inner.lock().await;
            if let Some(ref cached) = *guard
                && cached.expires_at_secs > now + REFRESH_BUFFER_SECS
            {
                return Ok(cached.token.clone());
            }
        }
        // Fetch a fresh token.
        let new_token = fetch_token(http, app_id, app_password, token_url).await?;
        let expires_at = now + new_token.expires_in.saturating_sub(REFRESH_BUFFER_SECS);
        let mut guard = self.inner.lock().await;
        *guard = Some(CachedToken {
            token: new_token.access_token.clone(),
            expires_at_secs: expires_at,
        });
        Ok(new_token.access_token)
    }
}

async fn fetch_token(
    http: &wcore_egress::EgressClient,
    app_id: &str,
    app_password: &str,
    token_url: &str,
) -> Result<TokenResponse, MsTeamsError> {
    let params = [
        ("grant_type", "client_credentials"),
        ("client_id", app_id),
        ("client_secret", app_password),
        ("scope", BF_TOKEN_SCOPE),
    ];

    let resp = http
        .post(token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| MsTeamsError::Network(e.to_string()))?;

    let status = resp.status().as_u16();
    if !resp.status().is_success() {
        // Do NOT read or surface the response body: the token POST sends
        // `client_secret`, and Azure AD error bodies can echo request context,
        // so the secret could reflect into logs via the error's Debug/Display.
        return Err(MsTeamsError::TokenFetch { status });
    }

    resp.json::<TokenResponse>()
        .await
        .map_err(|e| MsTeamsError::Parse(e.to_string()))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The non-2xx token-fetch error must never carry the response body: the
    /// token POST sends `client_secret`, and Azure AD bodies can echo it back.
    /// The error string (Display) and its Debug form must expose only the
    /// status, never any secret-bearing body content.
    #[test]
    fn token_fetch_error_omits_response_body_keeps_status() {
        // Simulates an Azure AD error body that echoes the request form,
        // including the secret. This is the kind of bytes `resp.text()` would
        // previously have captured into the error.
        let leaky_body = "error=invalid_client&error_description=client_secret=SHHH+is+invalid";

        // The construction path can no longer accept a body — the variant only
        // carries a status — which is exactly the property we want to lock in.
        let err = MsTeamsError::TokenFetch { status: 401 };

        let rendered = err.to_string();
        let debug = format!("{err:?}");

        // The status must survive for diagnostics.
        assert!(
            rendered.contains("401"),
            "error should include the HTTP status, got: {rendered}"
        );

        // The secret / form context must never reflect into the error.
        for needle in ["SHHH", "client_secret"] {
            assert!(
                !rendered.contains(needle),
                "Display error leaked `{needle}`: {rendered}"
            );
            assert!(
                !debug.contains(needle),
                "Debug error leaked `{needle}`: {debug}"
            );
        }

        // Guard against the leaky body slipping in verbatim.
        assert!(!rendered.contains(leaky_body));
        assert!(!debug.contains(leaky_body));
    }
}
