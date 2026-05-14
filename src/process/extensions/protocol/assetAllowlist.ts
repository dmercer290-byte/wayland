/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Allowlist enforcement for the `wayland-asset://` protocol.
 *
 * Without containment, the renderer (which can render untrusted LLM output)
 * could fetch arbitrary files via wayland-asset://asset//etc/passwd, SSH keys,
 * dotfiles, etc. This module defines the set of directories from which the
 * protocol may serve files and rejects any request that resolves outside
 * those roots (including symlink-escape attempts).
 *
 * Allowed roots match the producer sites of `toAssetUrl(...)`:
 *   - User / appdata / env-configured extension directories
 *     (see `getExtensionScanSources`).
 *   - The bundled hub resources directory (`<resources>/hub`).
 */

import * as path from 'path';
import {
  getAppDataExtensionsDir,
  getEnvExtensionsDirs,
  getHubResourcesDir,
  getUserExtensionsDir,
} from '../constants';
import { isPathWithinDirectory } from '../sandbox/pathSafety';

/**
 * Compute the set of directory roots from which `wayland-asset://` may
 * serve files. Directories are resolved to absolute paths and deduplicated.
 *
 * NOTE: We do not cache the result — env-configured extension dirs
 * (`WAYLAND_EXTENSIONS_PATH`) can change between calls in tests, and the
 * computation is cheap.
 */
export function buildAssetAllowlist(): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();

  const push = (dir: string | null | undefined) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    roots.push(resolved);
  };

  for (const envDir of getEnvExtensionsDirs()) push(envDir);
  push(getUserExtensionsDir());
  push(getAppDataExtensionsDir());
  push(getHubResourcesDir());

  return roots;
}

/**
 * Resolve `requestedPath` against the allowlist.
 *
 * Returns the absolute path when it is contained within at least one
 * allowed root, or `null` when the path is outside the allowlist (which
 * the caller must treat as a hard reject — 403/404 — and never serve).
 *
 * Containment is checked via `isPathWithinDirectory`, which canonicalises
 * symlinks before comparing, so symlink-escape attempts also return null.
 */
export function resolveAllowedAssetPath(requestedPath: string): string | null {
  if (!requestedPath) return null;
  const absolute = path.resolve(requestedPath);
  const allowlist = buildAssetAllowlist();
  for (const root of allowlist) {
    if (isPathWithinDirectory(absolute, root)) {
      return absolute;
    }
  }
  return null;
}
