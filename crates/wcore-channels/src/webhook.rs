//! Inbound webhook request/response types — the platform-neutral seam
//! between the inbound webhook HTTP host (in `wcore-agent`) and each
//! webhook-based connector's signature-verifying ingest path.
//!
//! Webhook connectors (Slack, WhatsApp, Twilio SMS) receive inbound
//! traffic as HTTP POSTs from the platform, not by polling. The host
//! owns the listener; it normalizes each request into a
//! [`WebhookRequest`] and routes it to the destination channel's
//! [`Channel::ingest_webhook`](crate::Channel::ingest_webhook), which
//! verifies the platform signature, parses the body, and enqueues the
//! resulting event(s) for the next `poll_events()`. The connector returns
//! a [`WebhookResponse`] the host writes back (e.g. Slack's
//! `url_verification` challenge, or a Meta `hub.challenge` echo).
//!
//! This module is dependency-free (no `http`/`axum` types) so the pure
//! `wcore-channels` crate stays decoupled from whatever server the host
//! uses.

/// One inbound webhook HTTP request, normalized for a connector to verify
/// and parse. The host fills this from the live request.
#[derive(Debug, Clone, Default)]
pub struct WebhookRequest {
    /// HTTP method, uppercased (`"POST"`, `"GET"`). Most platforms POST;
    /// Meta (WhatsApp) does a one-time `GET` verification handshake.
    pub method: String,
    /// The full URL the platform called — `scheme://host/path?query`.
    /// Signature schemes that sign the URL (Twilio) require this to match
    /// byte-for-byte what the platform signed, so the host reconstructs it
    /// from a configured public base URL when set (behind a proxy the local
    /// `Host` differs from the public URL).
    pub full_url: String,
    /// Request headers with **lowercased** names (HTTP header names are
    /// case-insensitive; lowercasing once here lets [`Self::header`] do a
    /// simple compare).
    pub headers: Vec<(String, String)>,
    /// Parsed query parameters (for Meta's `hub.*` GET verification).
    pub query: Vec<(String, String)>,
    /// Raw request body as received (UTF-8). Signature verification MUST
    /// run over these exact bytes — never a re-serialized form.
    pub body: String,
}

impl WebhookRequest {
    /// Case-insensitive header lookup. `name` is compared lowercased
    /// against the (already-lowercased) stored header names.
    pub fn header(&self, name: &str) -> Option<&str> {
        let want = name.to_ascii_lowercase();
        self.headers
            .iter()
            .find(|(k, _)| *k == want)
            .map(|(_, v)| v.as_str())
    }

    /// First query value for `key`, if present.
    pub fn query_get(&self, key: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
}

/// What the host should write back to the platform after a connector
/// handled (or rejected) a webhook.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebhookResponse {
    /// HTTP status to return.
    pub status: u16,
    /// Optional response body. Slack's `url_verification` returns the
    /// `challenge` string; Meta's GET verify echoes `hub.challenge`. Most
    /// runtime deliveries return `None` (empty 200).
    pub body: Option<String>,
}

impl WebhookResponse {
    /// Empty `200 OK` — the normal "received, enqueued" reply.
    pub fn ok() -> Self {
        Self {
            status: 200,
            body: None,
        }
    }

    /// `200 OK` echoing a verification challenge (Slack `url_verification`,
    /// Meta `hub.challenge`).
    pub fn challenge(body: impl Into<String>) -> Self {
        Self {
            status: 200,
            body: Some(body.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_lookup_is_case_insensitive() {
        let req = WebhookRequest {
            headers: vec![("x-slack-signature".into(), "v0=abc".into())],
            ..Default::default()
        };
        assert_eq!(req.header("X-Slack-Signature"), Some("v0=abc"));
        assert_eq!(req.header("x-slack-signature"), Some("v0=abc"));
        assert_eq!(req.header("missing"), None);
    }

    #[test]
    fn query_lookup() {
        let req = WebhookRequest {
            query: vec![
                ("hub.mode".into(), "subscribe".into()),
                ("hub.challenge".into(), "1234".into()),
            ],
            ..Default::default()
        };
        assert_eq!(req.query_get("hub.challenge"), Some("1234"));
        assert_eq!(req.query_get("nope"), None);
    }

    #[test]
    fn response_constructors() {
        assert_eq!(WebhookResponse::ok().body, None);
        assert_eq!(
            WebhookResponse::challenge("x"),
            WebhookResponse {
                status: 200,
                body: Some("x".into())
            }
        );
    }
}
