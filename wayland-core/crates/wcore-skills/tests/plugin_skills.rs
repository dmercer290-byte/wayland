// Lane D3 (G2/G4): load + namespace skills from an installed marketplace plugin.

use std::path::Path;

use wcore_skills::loader::load_plugin_skill_catalog;

fn write(p: &Path, body: &str) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

#[tokio::test]
async fn loads_and_namespaces_plugin_skills() {
    let tmp = tempfile::tempdir().unwrap();
    let skills = tmp.path().join("skills");
    write(
        &skills.join("hello/SKILL.md"),
        "---\nname: hello\ndescription: greets\n---\nSay hello.",
    );
    write(
        &skills.join("review/SKILL.md"),
        "---\nname: review\ndescription: reviews\n---\nReview it.",
    );

    let refs = load_plugin_skill_catalog(&skills, "acme/db").await;

    let mut names: Vec<&str> = refs.iter().map(|r| r.name.as_str()).collect();
    names.sort();
    assert_eq!(names, vec!["acme/db:hello", "acme/db:review"]);
}

#[tokio::test]
async fn missing_skills_dir_is_empty_not_error() {
    let tmp = tempfile::tempdir().unwrap();
    let refs = load_plugin_skill_catalog(&tmp.path().join("nope"), "acme/db").await;
    assert!(refs.is_empty());
}
