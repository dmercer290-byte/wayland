//! Host allowlist guard for fetching **untrusted, sender-supplied** URLs.
//!
//! Channel connectors (Discord, Slack, WhatsApp, …) receive media URLs inside
//! inbound messages an attacker controls. Fetching such a URL verbatim is an
//! SSRF vector (e.g. `http://169.254.169.254/…` cloud-metadata) and, when a
//! bearer token is attached, a credential-exfiltration vector.
//!
//! Unlike the open-web `is_safe_url` *denylist* (block private ranges, used
//! where the host set is genuinely open like WebFetch), channel media must
//! only ever come from the platform's own CDN. So we enforce a strict,
//! fail-closed **allowlist** here: anything not on the list is rejected —
//! which also excludes every private/metadata/localhost target for free.

/// Returns `true` only if `url` parses and its host matches one of `allowed`.
///
/// Each `allowed` entry is matched against the URL host case-insensitively:
///   - a plain entry (`"cdn.discordapp.com"`) requires an **exact** host match;
///   - a dot-prefixed entry (`".whatsapp.net"`) matches that domain **and any
///     subdomain** of it.
///
/// Fail-closed: an unparseable URL, a URL with no host, or a host that matches
/// nothing returns `false`. A lookalike like `cdn.discordapp.com.evil.test`
/// never matches `cdn.discordapp.com`.
pub fn host_in_allowlist(url: &str, allowed: &[&str]) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    allowed.iter().any(|entry| {
        let entry = entry.to_ascii_lowercase();
        match entry.strip_prefix('.') {
            Some(domain) => host == domain || host.ends_with(&format!(".{domain}")),
            None => host == entry,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DISCORD: &[&str] = &["cdn.discordapp.com", "media.discordapp.net"];
    const WA: &[&str] = &["lookaside.fbsbx.com", ".whatsapp.net"];

    #[test]
    fn allows_exact_cdn_host() {
        assert!(host_in_allowlist(
            "https://cdn.discordapp.com/a/b/x.png",
            DISCORD
        ));
        assert!(host_in_allowlist(
            "https://media.discordapp.net/x.png",
            DISCORD
        ));
    }

    #[test]
    fn blocks_metadata_and_localhost_ssrf() {
        assert!(!host_in_allowlist(
            "http://169.254.169.254/latest/meta-data/",
            DISCORD
        ));
        assert!(!host_in_allowlist("http://127.0.0.1:8080/x", DISCORD));
        assert!(!host_in_allowlist("http://localhost/x", DISCORD));
        assert!(!host_in_allowlist("http://[::1]/x", DISCORD));
    }

    #[test]
    fn blocks_lookalike_suffix_attack() {
        assert!(!host_in_allowlist(
            "https://cdn.discordapp.com.evil.test/x",
            DISCORD
        ));
        assert!(!host_in_allowlist(
            "https://evilcdn.discordapp.com/x",
            DISCORD
        ));
    }

    #[test]
    fn dot_prefixed_entry_matches_domain_and_subdomains() {
        assert!(host_in_allowlist("https://mmg.whatsapp.net/x", WA));
        assert!(host_in_allowlist("https://whatsapp.net/x", WA));
        assert!(!host_in_allowlist("https://whatsapp.net.evil.test/x", WA));
    }

    #[test]
    fn fails_closed_on_garbage() {
        assert!(!host_in_allowlist("not a url", DISCORD));
        assert!(!host_in_allowlist("", DISCORD));
        assert!(!host_in_allowlist("https:///nohost", DISCORD));
    }
}
