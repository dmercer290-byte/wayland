// Lane C4: end-to-end marketplace install — plan (pure) then commit.

use std::path::Path;

use wcore_cli::plugin::known::{MarketplaceRef, add_marketplace};
use wcore_cli::plugin::lockfile::read_lock;
use wcore_cli::plugin::marketplace::{commit_install, resolve_and_plan};
use wcore_pluginsrc::CompatibilityGrade;

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
fn plan_is_pure_then_commit_writes_store_and_lockfile() {
    let tmp = tempfile::tempdir().unwrap();
    let store = tmp.path().join("store");
    let quarantine = tmp.path().join("quarantine");
    let fixture = tmp.path().join("fixture");
    std::fs::create_dir_all(&store).unwrap();
    build_fixture(&fixture);

    // Register the marketplace by local path.
    add_marketplace(
        &store,
        MarketplaceRef {
            name: "local".into(),
            source: fixture.to_string_lossy().into_owned(),
            official: false,
        },
    )
    .unwrap();

    // Plan: pure. Returns the right adds + grade and writes NOTHING to the store.
    let planned = resolve_and_plan(&store, &quarantine, "local", "demo").unwrap();
    assert_eq!(planned.plan.plugin, "demo");
    assert_eq!(planned.plan.grade, CompatibilityGrade::ContentCompatible);
    assert!(
        planned
            .plan
            .adds
            .iter()
            .any(|a| a.kind == "skill" && a.name == "local/demo:hello"),
        "expected namespaced skill in plan adds, got {:?}",
        planned.plan.adds
    );
    let store_dir = store.join("demo@local");
    assert!(!store_dir.exists(), "planning must not write the store dir");
    assert!(
        read_lock(&store).unwrap().is_empty(),
        "planning writes no lock record"
    );

    // Commit: writes the self-contained native plugin dir + a lock record.
    let dir = commit_install(&store, &planned, "2026-06-15T00:00:00Z".into()).unwrap();
    assert_eq!(dir, store_dir);
    assert!(dir.join("plugin.toml").is_file(), "generated plugin.toml");
    assert!(
        dir.join("skills/hello/SKILL.md").is_file(),
        "skill copied into the store"
    );
    assert!(dir.join("provenance.json").is_file(), "provenance sidecar");

    let lock = read_lock(&store).unwrap();
    assert_eq!(lock.len(), 1);
    assert_eq!(lock[0].plugin, "demo");
    assert_eq!(lock[0].marketplace, "local");
    assert_eq!(lock[0].version, "0.1.0");
    assert_eq!(lock[0].installed_at, "2026-06-15T00:00:00Z");
}

#[test]
fn unofficial_marketplace_yields_unsigned_source_warning_official_does_not() {
    let tmp = tempfile::tempdir().unwrap();
    let store = tmp.path().join("store");
    let quarantine = tmp.path().join("quarantine");
    let fixture = tmp.path().join("fixture");
    std::fs::create_dir_all(&store).unwrap();
    build_fixture(&fixture);

    // Unofficial (user-added) marketplace → unsigned-source trust warning.
    add_marketplace(
        &store,
        MarketplaceRef {
            name: "local".into(),
            source: fixture.to_string_lossy().into_owned(),
            official: false,
        },
    )
    .unwrap();
    let planned = resolve_and_plan(&store, &quarantine, "local", "demo").unwrap();
    assert!(
        planned
            .plan
            .warnings
            .iter()
            .any(|w| w.kind == "unsigned-source"),
        "unofficial source must warn, got {:?}",
        planned.plan.warnings
    );

    // Official (bundled) marketplace pointing at the same fixture → no trust
    // warning (capability is still manifest-driven, independent of trust).
    add_marketplace(
        &store,
        MarketplaceRef {
            name: "bundled".into(),
            source: fixture.to_string_lossy().into_owned(),
            official: true,
        },
    )
    .unwrap();
    let official = resolve_and_plan(&store, &quarantine, "bundled", "demo").unwrap();
    assert!(
        !official
            .plan
            .warnings
            .iter()
            .any(|w| w.kind == "unsigned-source"),
        "official source must not warn, got {:?}",
        official.plan.warnings
    );
}

#[test]
fn list_is_marketplace_aware_and_tolerates_sidecars() {
    use wcore_cli::plugin::install::list_installed;
    use wcore_cli::plugin::marketplace::list_marketplace_installed;

    let tmp = tempfile::tempdir().unwrap();
    let store = tmp.path().join("store");
    let quarantine = tmp.path().join("quarantine");
    let fixture = tmp.path().join("fixture");
    std::fs::create_dir_all(&store).unwrap();
    build_fixture(&fixture);

    add_marketplace(
        &store,
        MarketplaceRef {
            name: "local".into(),
            source: fixture.to_string_lossy().into_owned(),
            official: false,
        },
    )
    .unwrap();
    let planned = resolve_and_plan(&store, &quarantine, "local", "demo").unwrap();
    commit_install(&store, &planned, "2026-06-15T00:00:00Z".into()).unwrap();

    // The store now holds known_marketplaces.json + installed.lock.json
    // sidecars alongside the demo@local dir. The legacy *.json scan must NOT
    // choke on those (regression: it parsed every json as a manifest).
    assert!(store.join("known_marketplaces.json").is_file());
    assert!(store.join("installed.lock.json").is_file());
    let legacy = list_installed(&store).expect("list_installed must skip non-manifest sidecars");
    assert!(
        legacy.is_empty(),
        "no legacy <name>.json plugins here, got {legacy:?}"
    );

    // The marketplace-aware listing finds the install via its provenance.
    let market = list_marketplace_installed(&store).unwrap();
    assert_eq!(market.len(), 1);
    assert_eq!(market[0].plugin, "demo");
    assert_eq!(market[0].marketplace, "local");
}

#[test]
fn uninstall_removes_dir_and_lockfile_record() {
    use wcore_cli::plugin::marketplace::{list_marketplace_installed, remove_marketplace_plugin};

    let tmp = tempfile::tempdir().unwrap();
    let store = tmp.path().join("store");
    let quarantine = tmp.path().join("quarantine");
    let fixture = tmp.path().join("fixture");
    std::fs::create_dir_all(&store).unwrap();
    build_fixture(&fixture);

    add_marketplace(
        &store,
        MarketplaceRef {
            name: "local".into(),
            source: fixture.to_string_lossy().into_owned(),
            official: false,
        },
    )
    .unwrap();
    let planned = resolve_and_plan(&store, &quarantine, "local", "demo").unwrap();
    let dir = commit_install(&store, &planned, "2026-06-15T00:00:00Z".into()).unwrap();
    assert!(dir.is_dir());
    assert_eq!(read_lock(&store).unwrap().len(), 1);
    assert_eq!(list_marketplace_installed(&store).unwrap().len(), 1);

    let removed = remove_marketplace_plugin(&store, "demo", "local").unwrap();
    assert!(removed, "an install dir should have been removed");
    assert!(!dir.exists(), "install dir must be gone");
    assert!(
        read_lock(&store).unwrap().is_empty(),
        "lock record must be gone"
    );
    assert!(list_marketplace_installed(&store).unwrap().is_empty());

    // Idempotent: removing again is a no-op, not an error.
    assert!(!remove_marketplace_plugin(&store, "demo", "local").unwrap());
}
