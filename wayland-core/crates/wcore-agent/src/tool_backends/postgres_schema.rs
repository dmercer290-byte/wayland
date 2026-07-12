//! v0.9.0 Wave-1 B8 — real `tokio-postgres` backend for the
//! `postgres_schema` introspection tool.
//!
//! The resolver picks a connection string from one of three env vars in
//! priority order and constructs a real backend; if NONE is set the
//! resolver returns `None` so `bootstrap.rs` registers the null-backed
//! default (which the registry's availability filter then drops, so the
//! model never sees a tool whose only response is "not configured").
//!
//! ## Resolver order
//!
//! 1. `DATABASE_URL`        — the Heroku / Twelve-Factor convention.
//! 2. `POSTGRES_URL`        — Vercel / Render alternative.
//! 3. `PG_CONN_STRING`      — bare libpq key/value escape hatch.
//!
//! ## SSRF posture
//!
//! Postgres clients connect directly over TCP — there is no HTTP layer
//! whose SSRF redirect policy we can lean on. So we parse the
//! `tokio_postgres::Config` and explicitly REJECT private ranges that an
//! attacker-supplied `DATABASE_URL` could otherwise pivot through:
//!
//! * IPv4 link-local 169.254.0.0/16   (covers cloud metadata endpoints).
//! * IPv4 private 10.0.0.0/8          (corporate / VPC internal).
//!
//! Note: 127.0.0.1 and `localhost` are NOT rejected — Postgres on
//! `localhost` is the common dev / sidecar pattern, and a model
//! talking to its own host has not crossed a trust boundary the way an
//! outbound fetch to 169.254 would. This matches the v0.9.0 Wave-1 B8
//! briefing's "allow localhost" carve-out.
//!
//! ## TLS posture
//!
//! TLS is wired through `tokio-postgres-rustls` (rustls 0.23 / ring),
//! gated on the `sslmode` of the connection string:
//!
//! * `disable` / absent  → `NoTls` (cleartext — dev / sidecar default).
//! * `require`           → encrypt, but DO NOT verify the server cert or
//!   hostname. This matches libpq's `require` semantics, where many
//!   managed providers (RDS, self-hosted) present certs chained to a
//!   private CA the client has no root for. Encryption-without-verification
//!   is the documented behaviour of that mode — see the PostgreSQL
//!   "SSL Support" table.
//! * `verify-ca` / `verify-full` → encrypt AND verify against the
//!   webpki-roots public-CA bundle (covers Supabase / Neon / public-CA
//!   RDS). We do not distinguish `verify-ca` from `verify-full` finer than
//!   rustls' built-in verifier, which checks both chain and SNI hostname.
//!
//! The trust store is the bundled `webpki-roots` set rather than the OS
//! store so verification is deterministic across the macOS / Linux /
//! Windows CI matrix.
//!
//! ## Two-layer timeouts
//!
//! Both `connect()` and every `query()` call wrap in
//! `tokio::time::timeout` so a hung peer cannot park the tool dispatch
//! loop. The connect cap is 5 s; queries cap at 10 s — enough for
//! `information_schema` reads on a healthy DB, short enough that a sick
//! peer surfaces as an error within one tool turn.
//!
//! ## EXPLAIN safety
//!
//! `explain_query` validates that the SQL begins with `SELECT` or
//! `WITH` and contains NO `;` — closing the multi-statement-attack
//! vector even though the connection runs as a read-only role. This is
//! defense-in-depth: the caller's role SHOULD be locked down, but the
//! tool does not get to assume it is.

use std::net::IpAddr;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rustls::ClientConfig as RustlsClientConfig;
use rustls::RootCertStore;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, ring, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use serde_json::{Map, Value, json};
use tokio_postgres::config::{Host, SslMode};
use tokio_postgres::types::Type;
use tokio_postgres::{Client, Config};
use tokio_postgres_rustls::MakeRustlsConnect;

use wcore_tools::postgres_schema_tool::{
    PostgresSchemaBackend, PostgresSchemaOp, PostgresSchemaOutcome,
};

use super::shared::read_env_key;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const QUERY_TIMEOUT: Duration = Duration::from_secs(10);

/// Live `tokio-postgres` backend used by the agent host.
///
/// Holds the parsed `tokio_postgres::Config` so every dispatch reconnects
/// with the validated config (no string re-parsing) — schema
/// introspection is low-frequency, so a per-call connect avoids the
/// long-lived connection-task plumbing.
#[derive(Debug)]
pub struct LiveTokioPostgresBackend {
    config: Config,
    tls: TlsMode,
}

/// How the `connect()` path should negotiate transport security, derived
/// from the connection string's `sslmode`. See the module-level "TLS
/// posture" section for the mapping rationale.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TlsMode {
    /// `sslmode=disable` or absent — cleartext (`NoTls`).
    Disabled,
    /// `sslmode=require`/`prefer` — encrypt, do NOT verify cert/hostname.
    EncryptNoVerify,
    /// `sslmode=verify-ca`/`verify-full` — encrypt AND verify against the
    /// webpki-roots public-CA bundle.
    EncryptVerify,
}

impl TlsMode {
    /// Map a parsed `tokio_postgres` `SslMode` onto our transport policy.
    ///
    /// `tokio-postgres` collapses libpq's six `sslmode` values into three
    /// (`Disable` / `Prefer` / `Require`). It cannot represent
    /// `verify-ca`/`verify-full` distinctly, so we re-scan the raw conn
    /// string for those tokens to decide whether to verify.
    fn from_config(ssl_mode: SslMode, conn_string: &str) -> Self {
        let lower = conn_string.to_ascii_lowercase();
        let wants_verify =
            lower.contains("sslmode=verify-ca") || lower.contains("sslmode=verify-full");
        match ssl_mode {
            SslMode::Disable => TlsMode::Disabled,
            // `Prefer`/`Require` both negotiate TLS when offered. We treat
            // `prefer` like `require` here (no cleartext fallback) — schema
            // introspection over an unverified-but-encrypted channel is the
            // safer default than silently downgrading to plaintext.
            _ if wants_verify => TlsMode::EncryptVerify,
            _ => TlsMode::EncryptNoVerify,
        }
    }
}

impl LiveTokioPostgresBackend {
    /// Construct from an already-validated `Config` and TLS policy. Use
    /// [`from_conn_string`](Self::from_conn_string) to validate the SSRF
    /// host policy and derive the TLS mode before instantiating.
    fn new(config: Config, tls: TlsMode) -> Self {
        Self { config, tls }
    }

    /// Parse `conn_string` (libpq URL or key/value) and validate:
    ///
    /// * `sslmode` is honoured (TLS for `require`/`verify-ca`/`verify-full`,
    ///   `NoTls` for `disable`/absent) — see the module "TLS posture" docs.
    /// * Hosts in 169.254/16 or 10.0.0.0/8 are REJECTED (SSRF).
    /// * At least one host is present.
    pub fn from_conn_string(conn_string: &str) -> Result<Self, String> {
        // `tokio-postgres` collapses libpq's six `sslmode` values into three
        // (`disable`/`prefer`/`require`); its parser REJECTS `verify-ca` and
        // `verify-full` outright. Normalize those to `require` so the string
        // parses, then derive the real (verifying) TLS posture from the
        // original `sslmode` token below.
        let normalized = normalize_sslmode_for_parsing(conn_string);
        let config = Config::from_str(&normalized)
            .map_err(|e| format!("invalid postgres connection string: {e}"))?;

        let hosts = config.get_hosts();
        if hosts.is_empty() {
            return Err("postgres connection string has no host".to_string());
        }
        for host in hosts {
            validate_host(host)?;
        }

        // Scan the ORIGINAL string (not the normalized one) so the
        // `verify-ca`/`verify-full` tokens still drive the verify decision.
        let tls = TlsMode::from_config(config.get_ssl_mode(), conn_string);
        Ok(Self::new(config, tls))
    }

    /// Open a connection honouring `self.tls`, with a 5 s connect timeout.
    ///
    /// The TLS (`MakeRustlsConnect`) and `NoTls` connectors are distinct
    /// concrete types, so each branch spawns its own connection task and
    /// returns the `Client` plus the spawned task handle. The caller aborts
    /// the handle once the query is done so we don't leak a tokio task.
    ///
    /// On any failure the `Err` arm carries a ready-made
    /// [`PostgresSchemaOutcome::Err`] so [`run`](Self::run) can early-return
    /// it directly.
    async fn connect(
        &self,
    ) -> Result<(Client, tokio::task::JoinHandle<()>), PostgresSchemaOutcome> {
        match self.tls {
            TlsMode::Disabled => {
                let connect_fut = self.config.connect(tokio_postgres::NoTls);
                match tokio::time::timeout(CONNECT_TIMEOUT, connect_fut).await {
                    Ok(Ok((client, connection))) => {
                        let task = tokio::spawn(async move {
                            let _ = connection.await;
                        });
                        Ok((client, task))
                    }
                    Ok(Err(e)) => Err(PostgresSchemaOutcome::Err(format!("connect failed: {e}"))),
                    Err(_) => Err(PostgresSchemaOutcome::Err(format!(
                        "connect timed out after {}s",
                        CONNECT_TIMEOUT.as_secs()
                    ))),
                }
            }
            TlsMode::EncryptNoVerify | TlsMode::EncryptVerify => {
                let tls = build_rustls_connector(self.tls)
                    .map_err(|e| PostgresSchemaOutcome::Err(format!("TLS setup failed: {e}")))?;
                let connect_fut = self.config.connect(tls);
                match tokio::time::timeout(CONNECT_TIMEOUT, connect_fut).await {
                    Ok(Ok((client, connection))) => {
                        let task = tokio::spawn(async move {
                            let _ = connection.await;
                        });
                        Ok((client, task))
                    }
                    Ok(Err(e)) => Err(PostgresSchemaOutcome::Err(format!("connect failed: {e}"))),
                    Err(_) => Err(PostgresSchemaOutcome::Err(format!(
                        "connect timed out after {}s",
                        CONNECT_TIMEOUT.as_secs()
                    ))),
                }
            }
        }
    }
}

/// Build a `tokio-postgres-rustls` connector for the given encrypted
/// [`TlsMode`]. Uses an explicit `ring` `CryptoProvider` (the crate enables
/// rustls' `ring` feature, NOT `aws-lc-rs`) so we never depend on a
/// process-wide default provider being installed.
///
/// * [`TlsMode::EncryptVerify`] → verify against the bundled `webpki-roots`
///   public-CA store (chain + SNI hostname), via rustls' built-in verifier.
/// * [`TlsMode::EncryptNoVerify`] → encrypt but accept any server cert
///   (libpq `require` semantics). Returns `Err` if called for
///   [`TlsMode::Disabled`], which has no TLS connector.
fn build_rustls_connector(mode: TlsMode) -> Result<MakeRustlsConnect, String> {
    let provider = Arc::new(ring::default_provider());

    let config = match mode {
        TlsMode::EncryptVerify => {
            let roots = RootCertStore {
                roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
            };
            RustlsClientConfig::builder_with_provider(provider)
                .with_safe_default_protocol_versions()
                .map_err(|e| format!("rustls provider does not support default versions: {e}"))?
                .with_root_certificates(roots)
                .with_no_client_auth()
        }
        TlsMode::EncryptNoVerify => RustlsClientConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .map_err(|e| format!("rustls provider does not support default versions: {e}"))?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoCertVerifier { provider }))
            .with_no_client_auth(),
        TlsMode::Disabled => {
            return Err("TLS connector requested for a non-TLS mode".to_string());
        }
    };

    Ok(MakeRustlsConnect::new(config))
}

/// `ServerCertVerifier` that accepts ANY server certificate without chain
/// or hostname validation — the rustls realisation of libpq `sslmode=require`
/// (encrypt, don't verify). Signature checks still delegate to the provider's
/// real verifiers so the handshake's transport crypto stays sound; only the
/// peer-identity trust decision is skipped.
#[derive(Debug)]
struct NoCertVerifier {
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for NoCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Rewrite `sslmode=verify-ca`/`verify-full` to `sslmode=require` so the
/// `tokio-postgres` parser (which only knows `disable`/`prefer`/`require`)
/// accepts the string. The verify decision is recovered separately by
/// re-scanning the original string in [`TlsMode::from_config`]. libpq
/// `sslmode` values are lowercase by convention; the verify-token detection
/// matches lowercase, so we normalize the same lowercase forms here.
fn normalize_sslmode_for_parsing(conn_string: &str) -> String {
    conn_string
        .replace("sslmode=verify-full", "sslmode=require")
        .replace("sslmode=verify-ca", "sslmode=require")
}

/// Reject hosts that look like the cloud-metadata or RFC1918 ranges.
/// Allows loopback (`localhost`, `127.0.0.1`, `::1`) — see module docs.
fn validate_host(host: &Host) -> Result<(), String> {
    match host {
        Host::Tcp(name) => {
            // Try to parse as an IP literal first. Hostnames that resolve
            // to a private IP at connect time are out of scope for v0.9.0
            // (we don't pre-resolve DNS); the local network operator who
            // sets DATABASE_URL is already inside the trust boundary.
            if let Ok(ip) = name.parse::<IpAddr>()
                && is_blocked_postgres_ip(ip)
            {
                return Err(format!(
                    "postgres host {ip} is in a blocked private range \
                     (169.254/16 link-local or 10.0.0.0/8)"
                ));
            }
            Ok(())
        }
        // Unix sockets / Windows named pipes — local-only by definition;
        // no SSRF surface.
        #[allow(unreachable_patterns)]
        _ => Ok(()),
    }
}

/// SSRF block list specific to `postgres_schema`. NARROWER than the
/// general `wcore_tools::url_safety::is_safe_url` policy because
/// localhost-Postgres is a legitimate dev pattern. See module docs.
fn is_blocked_postgres_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            // 169.254.0.0/16 link-local (covers cloud metadata).
            if o[0] == 169 && o[1] == 254 {
                return true;
            }
            // 10.0.0.0/8 RFC1918 private.
            if o[0] == 10 {
                return true;
            }
            false
        }
        IpAddr::V6(v6) => {
            // IPv4-mapped IPv6 — unwrap and re-check.
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_blocked_postgres_ip(IpAddr::V4(mapped));
            }
            // Block IPv6 link-local fe80::/10 (mirror of 169.254/16).
            let seg0 = v6.segments()[0];
            if (seg0 & 0xffc0) == 0xfe80 {
                return true;
            }
            false
        }
    }
}

/// Resolver — picks the first env-var that is set + non-empty and tries
/// to build a backend over it. Returns `None` when ALL three vars are
/// unset (the documented "no postgres available" state).
///
/// Returns `None` (not an error) on validation failures too — the
/// bootstrap path then registers the null-backed default. The validation
/// error is logged at WARN so an operator who misconfigured
/// `DATABASE_URL` can see why the tool is hidden.
pub async fn build_postgres_schema_backend() -> Option<Arc<dyn PostgresSchemaBackend>> {
    // Resolver order is load-bearing — see module docs.
    let (var_name, conn_string) = if let Some(v) = read_env_key("DATABASE_URL") {
        ("DATABASE_URL", v)
    } else if let Some(v) = read_env_key("POSTGRES_URL") {
        ("POSTGRES_URL", v)
    } else if let Some(v) = read_env_key("PG_CONN_STRING") {
        ("PG_CONN_STRING", v)
    } else {
        tracing::info!(
            "postgres_schema: no DATABASE_URL / POSTGRES_URL / PG_CONN_STRING set — tool hidden"
        );
        return None;
    };

    match LiveTokioPostgresBackend::from_conn_string(&conn_string) {
        Ok(backend) => {
            tracing::info!(
                env = var_name,
                "postgres_schema: backend configured from {var_name}"
            );
            Some(Arc::new(backend))
        }
        Err(err) => {
            tracing::warn!(
                env = var_name,
                error = %err,
                "postgres_schema: rejecting connection string — tool hidden"
            );
            None
        }
    }
}

#[async_trait]
impl PostgresSchemaBackend for LiveTokioPostgresBackend {
    async fn run(&self, op: PostgresSchemaOp) -> PostgresSchemaOutcome {
        // ── Connect (with timeout) ────────────────────────────────────
        // The TLS and NoTls connectors are different concrete types, so
        // each branch spawns its own connection task and yields just the
        // `Client`. `connect_task` keeps the spawned future handle alive so
        // we can abort it after the query.
        let (client, conn_task) = match self.connect().await {
            Ok(pair) => pair,
            Err(outcome) => return outcome,
        };

        // ── Query (with timeout) ──────────────────────────────────────
        let params: Vec<&str> = op.params();
        let dyn_params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = params
            .iter()
            .map(|p| p as &(dyn tokio_postgres::types::ToSql + Sync))
            .collect();

        let query_fut = client.query(op.sql(), &dyn_params);
        let outcome = match tokio::time::timeout(QUERY_TIMEOUT, query_fut).await {
            Ok(Ok(rows)) => PostgresSchemaOutcome::Ok(rows.iter().map(row_to_json).collect()),
            Ok(Err(e)) => PostgresSchemaOutcome::Err(format!("query failed: {e}")),
            Err(_) => PostgresSchemaOutcome::Err(format!(
                "query timed out after {}s",
                QUERY_TIMEOUT.as_secs()
            )),
        };

        conn_task.abort();
        outcome
    }
}

/// Convert one `tokio_postgres::Row` into a JSON object keyed by column
/// name. Mirrors the in-tree `live::TokioPostgresBackend` in
/// `wcore-tools` so the row shape matches the introspection tool's
/// `parse_*` helpers without coupling the two modules.
fn row_to_json(row: &tokio_postgres::Row) -> Value {
    let mut obj = Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        let value = match *col.type_() {
            Type::INT2 => row
                .try_get::<_, Option<i16>>(i)
                .ok()
                .flatten()
                .map(|v| json!(v))
                .unwrap_or(Value::Null),
            Type::INT4 => row
                .try_get::<_, Option<i32>>(i)
                .ok()
                .flatten()
                .map(|v| json!(v))
                .unwrap_or(Value::Null),
            Type::INT8 => row
                .try_get::<_, Option<i64>>(i)
                .ok()
                .flatten()
                .map(|v| json!(v))
                .unwrap_or(Value::Null),
            _ => row
                .try_get::<_, Option<String>>(i)
                .ok()
                .flatten()
                .map(Value::String)
                .unwrap_or(Value::Null),
        };
        obj.insert(col.name().to_string(), value);
    }
    Value::Object(obj)
}

/// Validate an EXPLAIN target SQL. v0.9.0 only allows read-only
/// `SELECT`/`WITH` explains and rejects any `;` (multi-statement
/// attack). Returns the validated SQL on success.
///
/// Public so the future `explain` tool wrapper (and tests) can call it
/// without duplicating the validation.
pub fn validate_explain_sql(sql: &str) -> Result<&str, String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("explain target SQL is empty".to_string());
    }
    if trimmed.contains(';') {
        return Err(
            "multi-statement SQL is not allowed (no ';' permitted in explain target)".to_string(),
        );
    }
    let head = trimmed
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    if head != "SELECT" && head != "WITH" {
        return Err(format!(
            "only read-only SELECT / WITH queries are allowed for EXPLAIN (got: {head})"
        ));
    }
    Ok(trimmed)
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ENV-var manipulation in tests must serialize so we don't race the
    // other tests in this binary. `serial_test` is a dev-dep on
    // `wcore-agent` already.
    use serial_test::serial;

    /// Clear all three env vars the resolver reads — every env-resolver
    /// test runs this so prior state cannot leak through.
    fn clear_env() {
        // SAFETY: tests using this helper are `#[serial]` so the env
        // mutation cannot race.
        unsafe {
            std::env::remove_var("DATABASE_URL");
            std::env::remove_var("POSTGRES_URL");
            std::env::remove_var("PG_CONN_STRING");
        }
    }

    fn set_env(name: &str, value: &str) {
        // SAFETY: see clear_env.
        unsafe { std::env::set_var(name, value) };
    }

    // ── Resolver: env-var matrix ──────────────────────────────────────

    #[tokio::test]
    #[serial]
    async fn build_postgres_schema_backend_returns_none_when_unset() {
        clear_env();
        assert!(build_postgres_schema_backend().await.is_none());
    }

    #[tokio::test]
    #[serial]
    async fn build_postgres_schema_backend_reads_database_url_first() {
        clear_env();
        set_env("DATABASE_URL", "postgres://u:p@db.example.com/app");
        set_env(
            "POSTGRES_URL",
            "postgres://u:p@should-not-use.example.com/x",
        );
        set_env("PG_CONN_STRING", "postgres://u:p@nope.example.com/y");
        let backend = build_postgres_schema_backend().await;
        assert!(backend.is_some(), "DATABASE_URL must produce a backend");
        clear_env();
    }

    #[tokio::test]
    #[serial]
    async fn build_postgres_schema_backend_falls_back_to_postgres_url() {
        clear_env();
        set_env("POSTGRES_URL", "postgres://u:p@db.example.com/app");
        let backend = build_postgres_schema_backend().await;
        assert!(backend.is_some(), "POSTGRES_URL must produce a backend");
        clear_env();
    }

    #[tokio::test]
    #[serial]
    async fn build_postgres_schema_backend_falls_back_to_pg_conn_string() {
        clear_env();
        // libpq key/value form — exercises Config::from_str on non-URL syntax.
        set_env("PG_CONN_STRING", "host=db.example.com user=u dbname=app");
        let backend = build_postgres_schema_backend().await;
        assert!(backend.is_some(), "PG_CONN_STRING must produce a backend");
        clear_env();
    }

    #[tokio::test]
    #[serial]
    async fn empty_string_env_is_ignored() {
        clear_env();
        set_env("DATABASE_URL", "   ");
        assert!(
            build_postgres_schema_backend().await.is_none(),
            "blank-only env var must not satisfy the resolver"
        );
        clear_env();
    }

    #[tokio::test]
    #[serial]
    async fn malformed_url_returns_none_and_logs_warning() {
        clear_env();
        set_env("DATABASE_URL", "this is not a postgres url");
        assert!(build_postgres_schema_backend().await.is_none());
        clear_env();
    }

    // ── Connection-string parsing + SSRF host validation ──────────────

    #[test]
    fn parses_database_url_correctly() {
        let backend =
            LiveTokioPostgresBackend::from_conn_string("postgres://u:p@db.example.com:5432/app")
                .expect("valid URL must parse");
        let hosts = backend.config.get_hosts();
        assert!(matches!(&hosts[0], Host::Tcp(h) if h == "db.example.com"));
        // Port lives in a parallel vec.
        assert_eq!(backend.config.get_ports(), &[5432]);
    }

    #[test]
    fn allows_localhost_127_0_0_1() {
        // Postgres on localhost is the common dev / sidecar pattern —
        // explicitly allow it (overrides the broader SSRF policy).
        LiveTokioPostgresBackend::from_conn_string("postgres://u:p@127.0.0.1:5432/app")
            .expect("localhost must be allowed");
        LiveTokioPostgresBackend::from_conn_string("postgres://u:p@localhost:5432/app")
            .expect("'localhost' hostname must be allowed");
    }

    #[test]
    fn rejects_host_in_link_local_169_254() {
        let err =
            LiveTokioPostgresBackend::from_conn_string("postgres://u:p@169.254.169.254:5432/app")
                .expect_err("link-local must be rejected");
        assert!(
            err.contains("169.254") || err.contains("blocked"),
            "got: {err}"
        );
    }

    #[test]
    fn rejects_host_in_private_10_range() {
        let err = LiveTokioPostgresBackend::from_conn_string("postgres://u:p@10.0.0.5:5432/app")
            .expect_err("10.x must be rejected");
        assert!(
            err.contains("10.0.0.0/8") || err.contains("blocked"),
            "got: {err}"
        );
    }

    #[test]
    fn accepts_sslmode_require_and_derives_encrypt_no_verify() {
        // rank-42: `sslmode=require` is the safe managed-Postgres default
        // (Supabase / RDS / Neon). It must build a backend, NOT the old
        // "TLS not yet implemented" rejection.
        let backend = LiveTokioPostgresBackend::from_conn_string(
            "postgres://u:p@db.example.com/app?sslmode=require",
        )
        .expect("sslmode=require must now be accepted");
        // `require` → encrypt but do NOT verify (libpq semantics).
        assert_eq!(backend.tls, TlsMode::EncryptNoVerify);
    }

    #[test]
    fn accepts_sslmode_verify_full_and_derives_encrypt_verify() {
        let backend = LiveTokioPostgresBackend::from_conn_string(
            "postgres://u:p@db.example.com/app?sslmode=verify-full",
        )
        .expect("sslmode=verify-full must be accepted");
        assert_eq!(backend.tls, TlsMode::EncryptVerify);
    }

    #[test]
    fn sslmode_disable_derives_disabled_tls() {
        let backend = LiveTokioPostgresBackend::from_conn_string(
            "postgres://u:p@db.example.com/app?sslmode=disable",
        )
        .expect("sslmode=disable must be accepted");
        assert_eq!(backend.tls, TlsMode::Disabled);
    }

    #[tokio::test]
    async fn sslmode_require_connect_fails_on_no_server_not_tls_rejection() {
        // rank-42: with TLS implemented, a `require` conn string that can't
        // reach a server must surface a CONNECTION error (connect/timeout),
        // NOT the old config-build "TLS not yet implemented" rejection.
        let backend = LiveTokioPostgresBackend::from_conn_string(
            "postgres://u:p@127.0.0.1:1/app?sslmode=require",
        )
        .expect("require conn string must build a backend");
        let outcome = backend
            .run(PostgresSchemaOp::ListTables {
                schema: "public".into(),
            })
            .await;
        match outcome {
            PostgresSchemaOutcome::Err(msg) => {
                assert!(
                    !msg.contains("TLS not yet implemented"),
                    "must not be the legacy TLS-rejection, got: {msg}"
                );
                assert!(
                    msg.contains("connect") || msg.contains("timed out"),
                    "expected a connection failure, got: {msg}"
                );
            }
            PostgresSchemaOutcome::Ok(_) => {
                panic!("connection to unbound port must not succeed")
            }
        }
    }

    #[test]
    fn rejects_malformed_url() {
        let err = LiveTokioPostgresBackend::from_conn_string("ftp://nope")
            .expect_err("non-postgres URL must fail to parse");
        assert!(
            err.contains("invalid postgres connection string"),
            "got: {err}"
        );
    }

    // ── EXPLAIN safety ────────────────────────────────────────────────

    #[test]
    fn explain_rejects_semicolon_injection() {
        let err = validate_explain_sql("SELECT 1; DROP TABLE users")
            .expect_err("semicolon must be rejected");
        assert!(err.contains("multi-statement"), "got: {err}");
    }

    #[test]
    fn explain_rejects_non_select() {
        for bad in [
            "DROP TABLE users",
            "UPDATE users SET admin=true",
            "INSERT INTO x VALUES (1)",
            "DELETE FROM x",
        ] {
            validate_explain_sql(bad)
                .err()
                .unwrap_or_else(|| panic!("non-SELECT '{bad}' was wrongly accepted"));
        }
        // Positive path: SELECT + WITH allowed.
        validate_explain_sql("SELECT 1").expect("plain SELECT must pass");
        validate_explain_sql("WITH x AS (SELECT 1) SELECT * FROM x").expect("WITH must pass");
    }

    #[test]
    fn explain_rejects_empty() {
        let err = validate_explain_sql("   ").expect_err("empty SQL must be rejected");
        assert!(err.contains("empty"), "got: {err}");
    }

    // ── Failure paths: connection refused + query timeout ─────────────

    #[tokio::test]
    async fn connection_refused_surfaces_as_outcome_err() {
        // Port 1 is privileged + unbound on essentially every host.
        // Connect attempts should fail within CONNECT_TIMEOUT (5s) with
        // either a refused-connection error or a timeout error.
        let backend = LiveTokioPostgresBackend::from_conn_string("postgres://u:p@127.0.0.1:1/app")
            .expect("valid URL");
        let outcome = backend
            .run(PostgresSchemaOp::ListTables {
                schema: "public".into(),
            })
            .await;
        match outcome {
            PostgresSchemaOutcome::Err(msg) => {
                assert!(
                    msg.contains("connect") || msg.contains("timed out"),
                    "expected connect-failure error, got: {msg}"
                );
            }
            PostgresSchemaOutcome::Ok(_) => {
                panic!("connection to unbound port must not succeed")
            }
        }
    }
}
