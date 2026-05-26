/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * ijfwSystemService — Wave 1 of v0.6.3 IJFW integration.
 *
 * Replaces the v0.6.2 `ijfwAutoInstallService`. Responsibilities:
 *   1. Detect a local IJFW install at `~/.ijfw/mcp-server` (lstat — symlink safe)
 *      and fall back to a PATH probe for CLI-only installs.
 *   2. Resolve the latest `@ijfw/install` version published to npm (via the
 *      Wave 0 `safeSpawn` wrapper — trusted npm CLI, allowlisted env).
 *   3. Bootstrap on first boot when no install is present; upgrade in place
 *      to a `.pending` directory when one is present and out of date.
 *   4. Activate `.pending` on the next boot via the full JSON-RPC envelope
 *      spawn-test (rolls back to `.prev` on failure).
 *   5. Surface install lifecycle via `ipcBridge.ijfw.onStatusChanged`.
 *
 * Decision 1a: we trust the npm OIDC publish chain rather than verifying a
 * (fake) on-the-wire fingerprint. The trust boundary lives at publish time.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildChildEnv } from '@process/services/ijfw/envAllowlist';

export type IjfwRuntimeMode = 'disabled' | 'enabled' | 'pending_activation';

export type IjfwDetectionResult = {
  installed: boolean;
  version?: string;
  mcpServerPath?: string;
  cliOnPath?: boolean;
  detectedVia: 'directory' | 'symlink' | 'cli' | 'none';
  pathProbe: {
    homebrew: boolean;
    usrLocal: boolean;
    standardPath: boolean;
  };
};

const NOT_IMPLEMENTED = new Error('ijfwSystemService: method not implemented yet (Wave 1 shell)');

let runtimeMode: IjfwRuntimeMode = 'disabled';

const HOMEBREW_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/home/linuxbrew/.linuxbrew/bin',
];

async function detectLocalInstallImpl(): Promise<IjfwDetectionResult> {
  const home = os.homedir();
  const target = path.join(home, '.ijfw', 'mcp-server');
  const pathProbe = { homebrew: false, usrLocal: false, standardPath: false };

  try {
    const stat = await fs.promises.lstat(target);
    let resolvedPath = target;
    let via: 'symlink' | 'directory' = 'directory';
    if (stat.isSymbolicLink()) {
      resolvedPath = await fs.promises.realpath(target);
      via = 'symlink';
    } else if (!stat.isDirectory()) {
      // Treat unknown filesystem object as not installed and fall through.
      throw new Error('not a directory or symlink');
    }
    try {
      const raw = await fs.promises.readFile(
        path.join(resolvedPath, 'package.json'),
        'utf-8',
      );
      const parsed = JSON.parse(raw) as { version?: unknown };
      const version = typeof parsed.version === 'string' ? parsed.version : undefined;
      return {
        installed: true,
        ...(version ? { version } : {}),
        mcpServerPath: resolvedPath,
        detectedVia: via,
        pathProbe,
      };
    } catch {
      return {
        installed: true,
        mcpServerPath: resolvedPath,
        detectedVia: via,
        pathProbe,
      };
    }
  } catch {
    /* fall through to PATH probe */
  }

  // SEC-006: filtered env, not raw process.env.
  const augmentedPath = [process.env.PATH ?? '', ...HOMEBREW_PATHS].join(path.delimiter);
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const which = spawnSync(cmd, ['ijfw'], {
    encoding: 'utf-8',
    env: buildChildEnv({ PATH: augmentedPath }),
  });
  if (which.status === 0 && typeof which.stdout === 'string' && which.stdout.trim().length > 0) {
    const resolved = which.stdout.trim().split(/\r?\n/)[0]!;
    pathProbe.homebrew = resolved.includes('homebrew') || resolved.includes('linuxbrew');
    pathProbe.usrLocal = resolved.includes('/usr/local/');
    pathProbe.standardPath = (process.env.PATH ?? '')
      .split(path.delimiter)
      .some((p) => p.length > 0 && resolved.startsWith(p));
    return {
      installed: true,
      cliOnPath: true,
      detectedVia: 'cli',
      pathProbe,
    };
  }
  return { installed: false, detectedVia: 'none', pathProbe };
}

export const ijfwSystemService = {
  async detectLocalInstall(): Promise<IjfwDetectionResult> {
    return detectLocalInstallImpl();
  },

  async getLatestPublished(): Promise<string | null> {
    throw NOT_IMPLEMENTED;
  },

  async bootstrap(): Promise<void> {
    throw NOT_IMPLEMENTED;
  },

  async applyPendingUpgrade(): Promise<void> {
    throw NOT_IMPLEMENTED;
  },

  getRuntimeMode(): IjfwRuntimeMode {
    return runtimeMode;
  },
};

/** Test-only — reset module-level state. */
export function __setRuntimeModeForTests(mode: IjfwRuntimeMode): void {
  runtimeMode = mode;
}
