/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression guard for the CRITICAL bundling defect found in the Phase-2a audit
 * (run wf_5c747059-284):
 *
 *   conciergeDiagServer.ts hard-imports the NATIVE module `better-sqlite3`, but
 *   the concierge-diag esbuild target inherited only `external:['electron','bun:sqlite']`,
 *   so esbuild INLINED better-sqlite3 + its bindings loader. At runtime the
 *   spawned `node out/main/builtin-mcp-concierge-diag.js` then resolved
 *   `require('bindings')('better_sqlite3.node')` relative to out/main (no
 *   build/Release there) and threw — `openReadonlyDb` caught it and returned
 *   `{available:false}`, killing the two SQLite-backed diagnostics sections
 *   (scheduledTasks + providers) in EVERY dev and packaged build. The existing
 *   conciergeDiagServer.test.ts used the UNBUNDLED node_modules module, so CI
 *   stayed green while the shipped artifact was broken.
 *
 * The fix marks `better-sqlite3` external for the diag target so `require`
 * resolves it at runtime from the asarUnpacked node_modules (mirroring the main
 * process). Verified empirically: bundled WITHOUT the external => providers()
 * available:false; WITH the external => available:true against a real SQLite DB.
 *
 * This test pins the build config so the external can never be silently dropped.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BUILD_SCRIPT = path.resolve(__dirname, '../../../../../scripts/build-mcp-servers.js');

describe('concierge-diag esbuild native-module externals', () => {
  it('marks better-sqlite3 external for the concierge-diag target', () => {
    const src = fs.readFileSync(BUILD_SCRIPT, 'utf-8');
    const outfileIdx = src.indexOf('builtin-mcp-concierge-diag.js');
    expect(outfileIdx).toBeGreaterThan(-1);

    // The esbuild.build({...}) object for the diag target precedes its outfile.
    // Confirm that block declares better-sqlite3 as external (a native module
    // must never be inlined into a stdio subprocess that opens SQLite).
    const blockStart = src.lastIndexOf('esbuild.build({', outfileIdx);
    expect(blockStart).toBeGreaterThan(-1);
    const block = src.slice(blockStart, outfileIdx);
    expect(block).toMatch(/external:\s*\[[^\]]*['"]better-sqlite3['"]/);
  });

  it('keeps better-sqlite3 OUT of the shared default externals (diag-only override)', () => {
    // Guard the inverse: the shared options must NOT externalize better-sqlite3
    // for every server (the others inline-but-never-open it); the override is
    // scoped to the diag target, which is the only server that opens SQLite.
    const src = fs.readFileSync(BUILD_SCRIPT, 'utf-8');
    const shared = src.match(/const SHARED_OPTIONS\s*=\s*\{[\s\S]*?external:\s*\[([^\]]*)\]/);
    expect(shared).not.toBeNull();
    expect(shared![1]).not.toMatch(/better-sqlite3/);
  });
});
