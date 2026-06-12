//! Send-time resolution of `@`-references (Wave 2).
//!
//! The composer lets the user type `@`-references; [`at_ref_complete`]
//! powers the autocomplete popup, but until now *nothing* turned those
//! references into content at send time — the literal `@src/main.rs` text
//! reached the LLM with no file body attached. This module closes that
//! gap: [`resolve_message`] scans the outgoing prompt, resolves the
//! references it can, and appends the resolved content as a labeled
//! context block so the model sees both the user's phrasing and the
//! referenced material.
//!
//! Scope (v1): the **local, deterministic** kinds — `@file`, `@dir`
//! (via [`at_ref_resolve::resolve`]) and `@diff` (via `git diff` in argv
//! mode). The kinds that need network egress (`@url`), a captured shell
//! buffer (`@output`), a session store (`@session`) or a repomap symbol
//! index (`@symbol`) are left as their literal text — a strict no-op, no
//! worse than today — and are the documented follow-up. Refusals (a
//! secret/git-ignored `@file`) are surfaced as an explicit note, never a
//! silent omission, matching the guarantee in [`at_ref_resolve`].
//!
//! Resolution runs inside the engine-bridge's async submit task (off the
//! UI thread), which is why `@diff`'s `git` subprocess is awaited here.

use std::collections::HashSet;
use std::path::Path;

use wcore_config::shell::shell_command_argv;

use super::at_ref_parse::AtRef;
use super::at_ref_resolve::{AtPayload, resolve};

/// Header that separates the user's text from the auto-resolved context.
const CONTEXT_HEADER: &str = "─── Referenced context (auto-resolved from @-mentions) ───";

/// Upper bound on a single `@diff` body spliced into the prompt. A huge
/// working-tree diff must not blow the context window; past this we
/// truncate with an explicit note.
const MAX_DIFF_BYTES: usize = 100_000;

/// A reference this module knows how to resolve at send time.
enum Resolvable {
    /// `@file` / `@dir` — resolved through the filesystem resolver, which
    /// already enforces the secret + gitignore guardrails and the `@dir`
    /// size budget.
    Fs(AtRef),
    /// `@diff` (working tree) or `@diff <ref>`.
    Diff(Option<String>),
}

/// Resolve the `@`-references in `text` against `root`, returning the
/// prompt the engine should see.
///
/// When the text carries no resolvable reference the input is returned
/// unchanged (no empty header is appended). Otherwise the original text is
/// preserved verbatim and a context block is appended.
pub async fn resolve_message(text: &str, root: &Path) -> String {
    let refs = scan(text);
    if refs.is_empty() {
        return text.to_string();
    }

    let mut blocks: Vec<String> = Vec::new();
    // Dedupe by rendered label so `@x @x` resolves once.
    let mut seen: HashSet<String> = HashSet::new();

    for r in refs {
        match r {
            Resolvable::Fs(at) => {
                if let Some(block) = render_fs(&at, root, &mut seen) {
                    blocks.push(block);
                }
            }
            Resolvable::Diff(base) => {
                let label = match &base {
                    Some(b) => format!("@diff {b}"),
                    None => "@diff".to_string(),
                };
                if seen.insert(label.clone()) {
                    blocks.push(render_diff(base, root).await);
                }
            }
        }
    }

    if blocks.is_empty() {
        return text.to_string();
    }
    format!("{text}\n\n{CONTEXT_HEADER}\n\n{}", blocks.join("\n\n"))
}

/// Scan a prompt for the references this module resolves. Whitespace
/// tokenization is sufficient: `@file`/`@dir`/`@symbol` are single tokens,
/// and the keyword kinds (`@diff`/`@url`/`@session`) take at most one
/// following argument token.
fn scan(text: &str) -> Vec<Resolvable> {
    let toks: Vec<&str> = text.split_whitespace().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let tok = toks[i];
        let Some(body) = tok.strip_prefix('@') else {
            i += 1;
            continue;
        };
        match tok {
            "@diff" => {
                // An optional base ref follows as its own token — but only
                // consume it when it is plain text, never another @-ref.
                let base = toks
                    .get(i + 1)
                    .filter(|n| !n.starts_with('@'))
                    .map(|s| s.to_string());
                if base.is_some() {
                    i += 1;
                }
                out.push(Resolvable::Diff(base));
            }
            // Network / session / shell-buffer kinds: consume their argument
            // token so it is not re-scanned, but leave them literal (v1
            // follow-up — they need egress / a session store / a captured
            // shell buffer respectively).
            "@url" | "@session" => {
                let consumes_arg = toks.get(i + 1).is_some_and(|n| !n.starts_with('@'));
                if consumes_arg {
                    i += 1;
                }
            }
            "@output" => {}
            _ if !body.is_empty() => {
                // A path or symbol token. Parse to classify; resolve only the
                // filesystem kinds, leave a bare `@Symbol` literal (follow-up).
                if let Ok(at @ (AtRef::File(_) | AtRef::Dir(_))) = AtRef::parse(tok) {
                    out.push(Resolvable::Fs(at));
                }
            }
            _ => {}
        }
        i += 1;
    }
    out
}

/// Render a `@file` / `@dir` reference, or an honest refusal note when the
/// resolver rejects it (secret, git-ignored, missing).
fn render_fs(at: &AtRef, root: &Path, seen: &mut HashSet<String>) -> Option<String> {
    let label = match at {
        AtRef::File(p) | AtRef::Dir(p) => format!("@{}", p.display()),
        _ => return None,
    };
    if !seen.insert(label.clone()) {
        return None;
    }
    match resolve(at, root) {
        Ok(payload) => Some(render_payload(&label, &payload)),
        Err(e) => Some(format!("▌ {label} — not attached: {e}")),
    }
}

/// Render a resolved filesystem payload into a labeled block. A `@dir`
/// payload carries many files; each is shown with its path. An oversized
/// `@dir` arrives names-only (the resolver's budget fallback), so an empty
/// body is rendered as a name entry rather than a blank.
fn render_payload(label: &str, payload: &AtPayload) -> String {
    let mut s = String::new();
    if payload.files.is_empty() {
        // A purely textual payload (shouldn't happen for File/Dir, but be
        // defensive) — emit the text under the label.
        return format!("▌ {label}\n{}", payload.text);
    }
    for (idx, f) in payload.files.iter().enumerate() {
        if idx > 0 {
            s.push_str("\n\n");
        }
        let path = f.path.display();
        if f.content.is_empty() {
            // Names-only entry (oversized @dir fallback).
            s.push_str(&format!(
                "▌ {label} › {path} (name only — tree over budget)"
            ));
        } else {
            s.push_str(&format!("▌ {label} › {path}\n{}", f.content));
        }
    }
    for w in &payload.warnings {
        s.push_str(&format!("\n⚠ {w}"));
    }
    s
}

/// Render `@diff` by running `git diff [base]` in argv mode under `root`.
/// Never returns an error — a git failure becomes an explicit note so the
/// turn still proceeds.
async fn render_diff(base: Option<String>, root: &Path) -> String {
    let label = match &base {
        Some(b) => format!("@diff {b}"),
        None => "@diff (working tree)".to_string(),
    };
    // The base ref comes from composer text (and a prompt-injected agent can
    // author that text). Even in argv mode — where no shell interprets the
    // token — git itself parses a leading `-` as an OPTION, not a revision:
    // `@diff --output=/etc/x` would smuggle `git diff --output=…`, an
    // arbitrary-file-write. Reject any `-`-prefixed base (a valid git ref
    // never starts with `-`, so nothing legitimate is lost) and terminate
    // option parsing with `--` so no following token can be read as a flag.
    let mut args: Vec<&str> = vec!["diff", "--no-color"];
    if let Some(b) = &base {
        if b.starts_with('-') {
            return format!(
                "▌ {label} — refusing a base ref that starts with '-' (looks like a flag, not a revision)"
            );
        }
        args.push(b);
    }
    args.push("--");
    let mut cmd = shell_command_argv("git", &args);
    cmd.current_dir(root);
    match cmd.output().await {
        Ok(out) if out.status.success() => {
            let body = String::from_utf8_lossy(&out.stdout);
            let body = body.trim_end();
            if body.is_empty() {
                format!("▌ {label}\n(no changes)")
            } else if body.len() > MAX_DIFF_BYTES {
                let cut = body
                    .char_indices()
                    .take_while(|(idx, _)| *idx < MAX_DIFF_BYTES)
                    .last()
                    .map(|(idx, c)| idx + c.len_utf8())
                    .unwrap_or(0);
                format!(
                    "▌ {label}\n{}\n… (diff truncated at {MAX_DIFF_BYTES} bytes)",
                    &body[..cut]
                )
            } else {
                format!("▌ {label}\n{body}")
            }
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr);
            format!("▌ {label} — git diff failed: {}", err.trim())
        }
        Err(e) => format!("▌ {label} — could not run git: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[tokio::test]
    async fn no_references_passes_through_unchanged() {
        let tmp = TempDir::new().unwrap();
        let text = "just a plain prompt with an email a@b.com in it";
        let out = resolve_message(text, tmp.path()).await;
        assert_eq!(out, text, "no @-ref → verbatim, no header");
    }

    #[tokio::test]
    async fn a_file_reference_is_inlined_under_the_header() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("note.txt"), "hello from the file").unwrap();
        let out = resolve_message("summarize @note.txt please", tmp.path()).await;
        // Original text preserved verbatim.
        assert!(out.starts_with("summarize @note.txt please"));
        assert!(out.contains(CONTEXT_HEADER));
        assert!(out.contains("hello from the file"));
        assert!(out.contains("@note.txt"));
    }

    #[tokio::test]
    async fn a_secret_reference_is_refused_loudly_not_attached() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".env"), "SECRET_KEY=hunter2").unwrap();
        let out = resolve_message("look at @.env", tmp.path()).await;
        // The secret value must never reach the resolved prompt.
        assert!(!out.contains("hunter2"), "secret body must not be inlined");
        // But the refusal is surfaced, not silently dropped.
        assert!(out.contains("not attached"));
    }

    #[tokio::test]
    async fn unsupported_kinds_stay_literal_with_no_header() {
        let tmp = TempDir::new().unwrap();
        // @url / @session / @output / @symbol are the v1 follow-up: they
        // resolve to nothing, so the message is unchanged (no empty header).
        let text = "check @url https://example.com and @output and @MyType";
        let out = resolve_message(text, tmp.path()).await;
        assert_eq!(out, text);
    }

    #[tokio::test]
    async fn a_missing_file_is_a_note_not_a_panic() {
        let tmp = TempDir::new().unwrap();
        let out = resolve_message("read @nope.txt", tmp.path()).await;
        assert!(out.contains("@nope.txt"));
        assert!(out.contains("not attached"));
    }

    #[tokio::test]
    async fn diff_against_the_working_tree_inlines_git_output() {
        // Init a throwaway repo, commit a file, modify it, then resolve
        // `@diff` — the working-tree change must appear in the context block.
        // git is available in CI / the build box; skip cleanly if not.
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .args(args)
                .current_dir(root)
                .output()
        };
        if run(&["init"]).is_err() {
            return; // no git in this environment — nothing to assert
        }
        let _ = run(&["config", "user.email", "t@t.t"]);
        let _ = run(&["config", "user.name", "t"]);
        fs::write(root.join("a.txt"), "one\n").unwrap();
        let _ = run(&["add", "a.txt"]);
        let _ = run(&["commit", "-m", "init"]);
        fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();

        let out = resolve_message("review @diff", root).await;
        assert!(out.contains(CONTEXT_HEADER));
        assert!(out.contains("@diff"));
        // The added line shows up in the unified diff.
        assert!(
            out.contains("+two"),
            "working-tree diff must be inlined: {out}"
        );
    }

    #[tokio::test]
    async fn diff_base_starting_with_dash_is_refused_not_smuggled_to_git() {
        // `@diff --output=<path>` must NOT reach git, where it would be parsed
        // as a flag and write the diff to an attacker-chosen file (argv mode
        // stops the shell, but git itself still parses leading-`-` as options).
        // The base is rejected with an explicit note and the sentinel file is
        // never created.
        let tmp = TempDir::new().unwrap();
        let sentinel = tmp.path().join("pwned.txt");
        let prompt = format!("diff @diff --output={}", sentinel.display());
        let out = resolve_message(&prompt, tmp.path()).await;
        assert!(
            out.contains("refusing a base ref that starts with '-'"),
            "flag-shaped base must be refused: {out}"
        );
        assert!(
            !sentinel.exists(),
            "git must never have run — the sentinel file must not exist"
        );
    }
}
