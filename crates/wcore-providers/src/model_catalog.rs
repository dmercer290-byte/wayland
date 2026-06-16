//! Per-provider disk cache for live model lists.
//!
//! Mirrors the pricing-layer cache pattern (`wcore-pricing::refresh`): each
//! provider's live `/v1/models` (or equivalent) result is snapshotted to
//! `~/.wayland/cache/models/{provider}.json` with a `fetched_at` timestamp and
//! a 24h TTL. A live model fetch consults this cache first; a fresh snapshot is
//! served without re-hitting the provider, and the file is rewritten after every
//! successful live fetch.
//!
//! This module is *only* the storage layer — it never performs HTTP. The
//! discovery service (Phase 3) wires it to the providers' `list_models`. The
//! engine's hard invariant that `list_models` never errors is upheld by the
//! callers: every fallible op here returns `Option`/`io::Result` so a corrupt
//! or missing cache degrades to "no cache" rather than propagating an error.
//!
//! Rollback flag: `WAYLAND_MODEL_DISCOVERY=off` disables live discovery; check
//! [`discovery_enabled`] before invoking a live fetch path.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::ModelInfo;

/// Default cache lifetime: model lists change rarely, so a 24h TTL keeps the
/// `/model` picker snappy without serving stale catalogs for long.
pub const DEFAULT_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Rollback env var. When set to `off` (case-insensitive), live model
/// discovery is disabled and callers should fall back to the static alias
/// catalog without touching the network or this cache.
const DISCOVERY_ENV: &str = "WAYLAND_MODEL_DISCOVERY";

/// On-disk snapshot of a provider's model list with the time it was fetched.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedModels {
    pub fetched_at: DateTime<Utc>,
    pub models: Vec<ModelInfo>,
}

/// Whether live model discovery is enabled. Returns `false` only when
/// `WAYLAND_MODEL_DISCOVERY` is set to `off` (case-insensitive); the default
/// (unset, or any other value) is enabled.
pub fn discovery_enabled() -> bool {
    match std::env::var(DISCOVERY_ENV) {
        Ok(v) => !v.trim().eq_ignore_ascii_case("off"),
        Err(_) => true,
    }
}

/// Resolve the cache file for `provider`:
/// `${WAYLAND_HOME|~/.wayland|./.wayland}/cache/models/{provider}.json`.
///
/// The provider segment is sanitized (path separators and NULs rewritten to
/// `_`, same rule as `OAuthStorage::path_for`) so a hostile provider name can't
/// escape the cache directory.
pub fn cache_path(provider: &str) -> PathBuf {
    let home = std::env::var_os("WAYLAND_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".wayland")))
        .unwrap_or_else(|| PathBuf::from("./.wayland"));
    let safe = provider.replace(['/', '\\', '\0'], "_");
    home.join("cache")
        .join("models")
        .join(format!("{safe}.json"))
}

/// Load `provider`'s cached model list if the snapshot exists and is within
/// `ttl`. Returns `None` for a missing, stale, or corrupt cache — never an
/// error, so the live-fetch path can treat a cache miss uniformly.
pub fn load_cached(provider: &str, ttl: Duration) -> Option<Vec<ModelInfo>> {
    let path = cache_path(provider);
    if !path.exists() {
        return None;
    }
    let raw = std::fs::read_to_string(&path).ok()?;
    let cached: CachedModels = serde_json::from_str(&raw).ok()?;
    let age = Utc::now().signed_duration_since(cached.fetched_at);
    if age.num_seconds().unsigned_abs() > ttl.as_secs() {
        return None;
    }
    Some(cached.models)
}

/// Snapshot `models` for `provider` to disk, stamped with the current time.
/// Creates the cache directory tree if needed.
pub fn save(provider: &str, models: &[ModelInfo]) -> std::io::Result<()> {
    let path = cache_path(provider);
    let cached = CachedModels {
        fetched_at: Utc::now(),
        models: models.to_vec(),
    };
    let json = serde_json::to_string_pretty(&cached)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    /// Point WAYLAND_HOME at a fresh tempdir for the duration of the returned
    /// guard. The guard keeps the dir alive and restores the prior env on drop.
    struct HomeGuard {
        _tmp: TempDir,
        prior: Option<std::ffi::OsString>,
    }

    impl HomeGuard {
        fn new() -> Self {
            let tmp = TempDir::new().unwrap();
            let prior = std::env::var_os("WAYLAND_HOME");
            // SAFETY: tests are serialized via #[serial]; no other thread reads
            // the env concurrently.
            unsafe { std::env::set_var("WAYLAND_HOME", tmp.path()) };
            Self { _tmp: tmp, prior }
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            // SAFETY: serialized; restore the prior value (or clear it).
            unsafe {
                match &self.prior {
                    Some(v) => std::env::set_var("WAYLAND_HOME", v),
                    None => std::env::remove_var("WAYLAND_HOME"),
                }
            }
        }
    }

    fn sample_models() -> Vec<ModelInfo> {
        vec![
            ModelInfo {
                id: "gpt-5".into(),
                display: "GPT-5".into(),
            },
            ModelInfo {
                id: "gpt-5-mini".into(),
                display: "GPT-5 Mini".into(),
            },
        ]
    }

    #[test]
    #[serial]
    fn save_then_load_round_trips() {
        let _guard = HomeGuard::new();
        let models = sample_models();
        save("openai", &models).unwrap();
        let loaded = load_cached("openai", DEFAULT_TTL).expect("fresh cache present");
        assert_eq!(loaded, models);
    }

    #[test]
    #[serial]
    fn load_returns_none_when_stale() {
        let _guard = HomeGuard::new();
        save("openai", &sample_models()).unwrap();
        // A zero TTL makes any non-zero age stale; rewrite fetched_at into the
        // past to be unambiguous even when the write completes in <1s.
        let path = cache_path("openai");
        let raw = std::fs::read_to_string(&path).unwrap();
        let mut cached: CachedModels = serde_json::from_str(&raw).unwrap();
        cached.fetched_at = Utc::now() - chrono::Duration::hours(48);
        std::fs::write(&path, serde_json::to_string_pretty(&cached).unwrap()).unwrap();
        assert!(load_cached("openai", DEFAULT_TTL).is_none());
    }

    #[test]
    #[serial]
    fn load_returns_none_when_missing() {
        let _guard = HomeGuard::new();
        assert!(load_cached("never-saved", DEFAULT_TTL).is_none());
    }

    #[test]
    #[serial]
    fn load_returns_none_when_corrupt() {
        let _guard = HomeGuard::new();
        let path = cache_path("openai");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ not valid json ][").unwrap();
        assert!(load_cached("openai", DEFAULT_TTL).is_none());
    }

    #[test]
    #[serial]
    fn cache_path_sanitizes_traversal() {
        let _guard = HomeGuard::new();
        let p = cache_path("../../etc/passwd");
        let name = p.file_name().unwrap().to_string_lossy();
        assert!(
            !name.contains('/') && !name.contains('\\'),
            "path traversal must be neutralized: {name}"
        );
        assert!(p.ends_with("cache/models/.._.._etc_passwd.json"));
    }

    #[test]
    #[serial]
    fn discovery_enabled_respects_off_flag() {
        // SAFETY: serialized test; restore handled below.
        let prior = std::env::var_os(DISCOVERY_ENV);
        unsafe { std::env::set_var(DISCOVERY_ENV, "off") };
        assert!(!discovery_enabled());
        unsafe { std::env::set_var(DISCOVERY_ENV, "OFF") };
        assert!(!discovery_enabled());
        unsafe { std::env::set_var(DISCOVERY_ENV, "on") };
        assert!(discovery_enabled());
        unsafe { std::env::remove_var(DISCOVERY_ENV) };
        assert!(discovery_enabled());
        unsafe {
            match prior {
                Some(v) => std::env::set_var(DISCOVERY_ENV, v),
                None => std::env::remove_var(DISCOVERY_ENV),
            }
        }
    }
}
