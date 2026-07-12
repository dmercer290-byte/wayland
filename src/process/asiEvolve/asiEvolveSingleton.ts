/**
 * Config accessor for the ASI-Evolve MCP server. Unlike hub-tools this needs
 * no main-process service (the stdio server drives the Python CLI directly),
 * so there is nothing to start - `getAsiEvolveStdioConfig` just builds the
 * stdio launch config, and returns null when ASI-Evolve isn't installed so a
 * broken server is never injected. WCoreManager reads it for every solo AND
 * team wcore session.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { StdioMcpConfig } from '@process/team/mcp/team/TeamMcpServer';
import { resolveMcpScriptDir } from '@process/team/mcp/tcpHelpers';
import { resolveAsiEvolveDir } from './asiEvolveFormat';

/**
 * @param userDataDir Electron userData path (injected so this stays testable).
 * @returns the stdio config, or null when ASI-Evolve is not installed.
 */
export function getAsiEvolveStdioConfig(userDataDir: string): StdioMcpConfig | null {
  const dir = resolveAsiEvolveDir(process.env, userDataDir);
  // Only inject when the framework is actually present - main.py is its entry.
  if (!fs.existsSync(path.join(dir, 'main.py'))) return null;

  const scriptPath = path.join(resolveMcpScriptDir(), 'asi-evolve-mcp-stdio.js');
  return {
    name: 'wayland-asi-evolve',
    command: 'node',
    args: [scriptPath],
    env: [{ name: 'ASI_EVOLVE_DIR', value: dir }],
  };
}
