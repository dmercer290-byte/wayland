use wcore_pluginsrc::mcp_registry::McpRegistryAdapter;
use wcore_pluginsrc::model::CompatibilityGrade;

#[test]
fn wraps_single_mcp_entry_as_mcp_compatible_draft() {
    let json = r#"{"name":"fetch","command":"uvx","args":["mcp-server-fetch"],"env":{}}"#;
    let draft = McpRegistryAdapter::from_json("registry", json).unwrap();
    assert_eq!(draft.namespace, "registry/fetch");
    assert_eq!(draft.mcp_servers.len(), 1);
    assert_eq!(draft.effective_grade(), CompatibilityGrade::McpCompatible);
    assert!(draft.skills.is_empty() && draft.agents.is_empty());
}

#[test]
fn rejects_entry_with_neither_command_nor_url() {
    let json = r#"{"name":"broken"}"#;
    assert!(McpRegistryAdapter::from_json("registry", json).is_err());
}
