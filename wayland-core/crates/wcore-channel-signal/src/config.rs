//! `SignalConfig` — per-channel options parsed from the `options`
//! table of a `ChannelConfig` TOML file.
//!
//! The adapter spawns `signal-cli -a <account> jsonRpc` as a child
//! process and exchanges JSON-RPC frames over stdio. No secrets live
//! in this struct; `signal-cli` manages its own state directory.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SignalConfig {
    /// Path to the `signal-cli` executable. Defaults to looking up
    /// `signal-cli` on `$PATH`.
    #[serde(default = "default_signal_cli_path")]
    pub signal_cli_path: PathBuf,

    /// Signal account identifier (typically the registered phone
    /// number, e.g. `+15551234567`). Passed to `signal-cli -a`.
    pub account: String,

    /// Per-request timeout (seconds) for outbound send_message
    /// JSON-RPC round-trips.
    #[serde(default = "default_send_timeout_secs")]
    pub send_timeout_secs: u64,

    /// Directory signal-cli writes inbound attachments to. When unset, the
    /// connector replicates signal-cli's own default config-dir resolution and
    /// appends `attachments` (see [`SignalConfig::resolve_attachments_dir`]).
    /// Set this only when signal-cli runs with a non-default config dir.
    #[serde(default)]
    pub attachments_dir: Option<PathBuf>,
}

impl SignalConfig {
    /// Resolve the directory inbound attachments live in. An explicit
    /// `attachments_dir` wins; otherwise mirror signal-cli's default config-dir
    /// resolution (`SIGNAL_CLI_CONFIG` → `$XDG_DATA_HOME/signal-cli` →
    /// `$HOME/.local/share/signal-cli`) and append `attachments`.
    pub fn resolve_attachments_dir(&self) -> PathBuf {
        if let Some(dir) = &self.attachments_dir {
            return dir.clone();
        }
        default_attachments_dir_from(
            std::env::var("SIGNAL_CLI_CONFIG").ok().as_deref(),
            std::env::var("XDG_DATA_HOME").ok().as_deref(),
            std::env::var("HOME").ok().as_deref(),
        )
    }
}

/// Pure core of signal-cli's config-dir resolution, appending `attachments`.
fn default_attachments_dir_from(
    signal_cli_config: Option<&str>,
    xdg_data_home: Option<&str>,
    home: Option<&str>,
) -> PathBuf {
    let config_dir = if let Some(c) = signal_cli_config.filter(|s| !s.is_empty()) {
        PathBuf::from(c)
    } else if let Some(x) = xdg_data_home.filter(|s| !s.is_empty()) {
        PathBuf::from(x).join("signal-cli")
    } else {
        PathBuf::from(home.unwrap_or(""))
            .join(".local")
            .join("share")
            .join("signal-cli")
    };
    config_dir.join("attachments")
}

fn default_signal_cli_path() -> PathBuf {
    PathBuf::from("signal-cli")
}

fn default_send_timeout_secs() -> u64 {
    10
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimal_config_uses_defaults() {
        let cfg: SignalConfig = toml::from_str(
            r#"
account = "+15551234567"
"#,
        )
        .unwrap();
        assert_eq!(cfg.account, "+15551234567");
        assert_eq!(cfg.signal_cli_path, PathBuf::from("signal-cli"));
        assert_eq!(cfg.send_timeout_secs, 10);
    }

    #[test]
    fn full_config_round_trips() {
        let src = r#"
signal_cli_path = "/usr/local/bin/signal-cli"
account = "+15551234567"
send_timeout_secs = 30
"#;
        let cfg: SignalConfig = toml::from_str(src).unwrap();
        assert_eq!(
            cfg.signal_cli_path,
            PathBuf::from("/usr/local/bin/signal-cli")
        );
        assert_eq!(cfg.account, "+15551234567");
        assert_eq!(cfg.send_timeout_secs, 30);
    }

    #[test]
    fn unknown_field_rejected() {
        let src = r#"
account = "+1"
unknown = "boom"
"#;
        let err = toml::from_str::<SignalConfig>(src).expect_err("expected deny_unknown_fields");
        assert!(
            err.to_string().contains("unknown"),
            "error should mention unknown field, got: {err}"
        );
    }

    #[test]
    fn missing_required_account_errors() {
        let err = toml::from_str::<SignalConfig>("").expect_err("expected missing required field");
        assert!(
            err.to_string().contains("account"),
            "error should mention `account`, got: {err}"
        );
    }

    #[test]
    fn default_attachments_dir_prefers_signal_cli_config() {
        let got = default_attachments_dir_from(Some("/srv/sig"), Some("/x"), Some("/home/u"));
        assert_eq!(got, PathBuf::from("/srv/sig/attachments"));
    }

    #[test]
    fn default_attachments_dir_uses_xdg_when_no_explicit_config() {
        let got = default_attachments_dir_from(None, Some("/x/data"), Some("/home/u"));
        assert_eq!(got, PathBuf::from("/x/data/signal-cli/attachments"));
    }

    #[test]
    fn default_attachments_dir_falls_back_to_home_local_share() {
        let got = default_attachments_dir_from(None, None, Some("/home/u"));
        assert_eq!(
            got,
            PathBuf::from("/home/u/.local/share/signal-cli/attachments")
        );
        // Empty strings are treated as unset, not as a literal empty path.
        let got2 = default_attachments_dir_from(Some(""), Some(""), Some("/home/u"));
        assert_eq!(
            got2,
            PathBuf::from("/home/u/.local/share/signal-cli/attachments")
        );
    }

    #[test]
    fn explicit_attachments_dir_overrides_resolution() {
        let cfg: SignalConfig = toml::from_str(
            r#"
account = "+15551234567"
attachments_dir = "/custom/att"
"#,
        )
        .unwrap();
        assert_eq!(cfg.resolve_attachments_dir(), PathBuf::from("/custom/att"));
    }
}
