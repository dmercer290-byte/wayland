// Lane F1: `plugin marketplace` CLI verbs + `install <plugin>@<mkt> --dry-run`.
//
// Drives the real `plugin::run` dispatcher and asserts on-disk state (the
// commands print to stdout; correctness is verified via the store + lockfile).

use std::path::Path;

use wcore_cli::plugin::known::list_marketplaces;
use wcore_cli::plugin::lockfile::read_lock;
use wcore_cli::plugin::{MarketplaceCmd, PluginArgs, PluginCmd, run};

fn write(p: &Path, body: &str) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// A local marketplace dir holding one relative-path Claude Code plugin.
fn build_fixture(dir: &Path) {
    write(
        &dir.join(".claude-plugin/marketplace.json"),
        r#"{
          "name": "local",
          "owner": { "name": "Tester" },
          "plugins": [ { "name": "demo", "source": "./demo" } ]
        }"#,
    );
    write(
        &dir.join("demo/.claude-plugin/plugin.json"),
        r#"{"name":"demo","version":"0.1.0","description":"demo plugin"}"#,
    );
    write(
        &dir.join("demo/skills/hello/SKILL.md"),
        "---\nname: hello\ndescription: greets\n---\nSay hello.",
    );
}

#[test]
fn marketplace_add_list_then_install_via_cli() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("plugins");
    let fixture = tmp.path().join("fixture");
    build_fixture(&fixture);

    // `plugin marketplace add <local path>` registers the catalog by its name.
    run(PluginArgs {
        install_root: Some(root.clone()),
        cmd: PluginCmd::Marketplace {
            cmd: MarketplaceCmd::Add {
                source: fixture.to_string_lossy().into_owned(),
            },
        },
    })
    .unwrap();
    let listed = list_marketplaces(&root).unwrap();
    assert!(
        listed.iter().any(|m| m.name == "local"),
        "marketplace 'local' should be registered, got {listed:?}"
    );

    // `plugin install demo@local --dry-run` writes NOTHING.
    run(PluginArgs {
        install_root: Some(root.clone()),
        cmd: PluginCmd::Install {
            name: "demo@local".into(),
            source: "local".into(),
            registry_dir: None,
            dry_run: true,
        },
    })
    .unwrap();
    assert!(
        !root.join("demo@local").exists(),
        "dry run must not install"
    );
    assert!(
        read_lock(&root).unwrap().is_empty(),
        "dry run writes no lock"
    );

    // `plugin install demo@local` writes the store dir + a lock record.
    run(PluginArgs {
        install_root: Some(root.clone()),
        cmd: PluginCmd::Install {
            name: "demo@local".into(),
            source: "local".into(),
            registry_dir: None,
            dry_run: false,
        },
    })
    .unwrap();
    assert!(
        root.join("demo@local/plugin.toml").is_file(),
        "real install writes the native plugin dir"
    );
    let lock = read_lock(&root).unwrap();
    assert_eq!(lock.len(), 1);
    assert_eq!(lock[0].plugin, "demo");
    assert_eq!(lock[0].marketplace, "local");
}

#[test]
fn dry_run_rejected_for_legacy_install() {
    let tmp = tempfile::tempdir().unwrap();
    // A bare name (no `@`) with --dry-run is an error: dry-run is marketplace-only.
    let err = run(PluginArgs {
        install_root: Some(tmp.path().to_path_buf()),
        cmd: PluginCmd::Install {
            name: "some-plugin".into(),
            source: "local".into(),
            registry_dir: None,
            dry_run: true,
        },
    })
    .unwrap_err();
    assert!(
        err.to_string().contains("--dry-run is only supported"),
        "expected dry-run rejection, got: {err}"
    );
}
