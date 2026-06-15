//! Raw-MCP-registry adapter. Wraps a single MCP server entry (from the official
//! MCP registry, Smithery, mcp.so, a Docker MCP Toolkit entry, or a pasted
//! `{name, command, args, env}`) as a one-server [`CanonicalDraft`] graded
//! `McpCompatible`. MCP is the universal substrate, so this is near-free and
//! covers the thousands of servers that ship as no plugin at all.

use std::collections::BTreeMap;

use serde::Deserialize;
use wcore_plugin_api::mcp_server_spec::McpTransport;

use crate::Result;
use crate::error::PluginSrcError;
use crate::model::{CanonicalDraft, McpServerDraft};

pub struct McpRegistryAdapter;

#[derive(Debug, Deserialize)]
struct RawMcpEntry {
    name: String,
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
    url: Option<String>,
    #[serde(rename = "type")]
    transport_type: Option<String>,
}

impl McpRegistryAdapter {
    /// Lower a single raw MCP server JSON description into a one-server draft.
    pub fn from_json(registry: &str, json: &str) -> Result<CanonicalDraft> {
        let raw: RawMcpEntry = serde_json::from_str(json)?;
        let transport = if let Some(command) = raw.command {
            McpTransport::Stdio {
                command,
                args: raw.args,
            }
        } else if let Some(url) = raw.url {
            match raw.transport_type.as_deref() {
                Some("sse") => McpTransport::Sse { url },
                _ => McpTransport::Http { url },
            }
        } else {
            return Err(PluginSrcError::PluginManifest(format!(
                "mcp entry {} has neither command nor url",
                raw.name
            )));
        };
        let mut draft = CanonicalDraft::empty(registry, &raw.name);
        draft.mcp_servers.push(McpServerDraft {
            name: raw.name,
            transport,
            env: raw.env,
        });
        draft.grade = draft.effective_grade();
        Ok(draft)
    }
}
