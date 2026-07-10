/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Transcript logger - mirrors every chat message, tool call, and thinking
 * block into `<workspace>/.ijfw/memory/transcript.md` so the Memory page
 * (IJFW archive) shows the full session transcript alongside curated memory.
 *
 * Design constraints:
 * - Streamed messages arrive as many `accumulate` updates; a block is only
 *   appended after QUIET_MS without further updates so each message lands
 *   once, with its final content.
 * - The archive parser splits files on lone `---` lines, so body content is
 *   sanitized to never emit one.
 * - Appends are serialized per file to prevent interleaved blocks.
 * - Everything is fire-and-forget: transcript logging must never break the
 *   message pipeline, so all errors are swallowed after a console.error.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { TMessage } from '@/common/chat/chatLib';
import { ProcessConfig } from '../../utils/initStorage';
import { getDatabase } from '../database/export';
import { appendEpisodes, distillEpisodes } from './episodicMemory';
import {
  TRANSCRIPT_HEADER,
  TRANSCRIPT_KIND_BY_TYPE,
  formatTranscriptBlock,
  splitTranscriptForRotation,
} from './transcriptFormat';

const gzip = promisify(zlib.gzip);

/** Snapshot a message after this long without updates (stream settled). */
const QUIET_MS = 5000;
/** Remember at most this many already-logged message keys per process. */
const MAX_LOGGED_KEYS = 4000;
/** Rotate transcript.md once it grows past this... */
const ROTATE_AT_BYTES = 1024 * 1024;
/** ...keeping the newest whole blocks up to this size in place. */
const KEEP_BYTES = 256 * 1024;
/** Re-read the Settings toggle at most this often. */
const ENABLED_TTL_MS = 15_000;

let enabledCache: { value: boolean; readAt: number } | null = null;

async function isEnabled(): Promise<boolean> {
  const now = Date.now();
  if (enabledCache && now - enabledCache.readAt < ENABLED_TTL_MS) return enabledCache.value;
  let value = true;
  try {
    value = (await ProcessConfig.get('memory.transcriptLogging')) !== false;
  } catch {
    value = true;
  }
  enabledCache = { value, readAt: now };
  return value;
}

/** Called by the settings bridge so a toggle applies immediately. */
export function invalidateTranscriptLoggingCache(): void {
  enabledCache = null;
}

type PendingEntry = { message: TMessage; timer: NodeJS.Timeout };

const pending = new Map<string, PendingEntry>();
const loggedKeys = new Set<string>();
const workspaceCache = new Map<string, string | null>();
const appendChains = new Map<string, Promise<void>>();
let registryEnsured = new Set<string>();

/** Test seam: reset all module state. */
export function resetTranscriptLoggerState(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  loggedKeys.clear();
  workspaceCache.clear();
  appendChains.clear();
  registryEnsured = new Set<string>();
}

/**
 * Record a message for transcript logging. Called from the message sync
 * chokepoint for every insert/accumulate; debounces internally.
 */
export function recordTranscriptMessage(conversation_id: string, message: TMessage): void {
  try {
    if (!message || !message.type || !(message.type in TRANSCRIPT_KIND_BY_TYPE)) return;
    const key = `${conversation_id}:${message.id ?? message.msg_id ?? ''}`;
    if (!key.includes(':') || key.endsWith(':')) return;
    if (loggedKeys.has(key)) return;

    const existing = pending.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      pending.delete(key);
      void flushMessage(key, conversation_id, message);
    }, QUIET_MS);
    // Do not keep the process alive just for transcript flushes.
    timer.unref?.();
    pending.set(key, { message, timer });
  } catch (err) {
    console.error('[TranscriptLogger] record failed:', err);
  }
}

async function flushMessage(key: string, conversation_id: string, message: TMessage): Promise<void> {
  try {
    if (!(await isEnabled())) return;
    const workspace = await resolveWorkspace(conversation_id);
    if (!workspace) return;

    rememberLoggedKey(key);
    const block = formatTranscriptBlock(conversation_id, message);
    if (!block) return;

    const memDir = path.join(workspace, '.ijfw', 'memory');
    const filePath = path.join(memDir, 'transcript.md');
    await appendSerialized(filePath, async () => {
      await fs.promises.mkdir(memDir, { recursive: true });
      let header = '';
      try {
        await fs.promises.access(filePath);
      } catch {
        header = TRANSCRIPT_HEADER;
      }
      await fs.promises.appendFile(filePath, header + block, 'utf8');
      await ensureRegistered(workspace);
      await rotateIfOversized(memDir, filePath);
    });
  } catch (err) {
    console.error('[TranscriptLogger] flush failed:', err);
  }
}

/**
 * Auto-compression: once transcript.md passes ROTATE_AT_BYTES, the older
 * blocks are gzipped into `.ijfw/memory/transcript-archive/` (outside the
 * archive scanner's file list, so the Memory index and its token/scan cost
 * stay bounded) and only the newest KEEP_BYTES of whole blocks remain live.
 * Runs inside the per-file append chain, so no concurrent writer interleaves.
 */
async function rotateIfOversized(memDir: string, filePath: string): Promise<void> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size <= ROTATE_AT_BYTES) return;

    const content = await fs.promises.readFile(filePath, 'utf8');
    const { keep, archive } = splitTranscriptForRotation(content, KEEP_BYTES);
    if (!archive) return;

    const archiveDir = path.join(memDir, 'transcript-archive');
    await fs.promises.mkdir(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(archiveDir, `transcript-${stamp}.md.gz`);
    const compressed = await gzip(Buffer.from(archive, 'utf8'));
    await fs.promises.writeFile(archivePath, compressed);

    // Episodic sidecar: distill the slice that is leaving the live transcript
    // into compact per-conversation episodes BEFORE it becomes an opaque gzip.
    // Best-effort - a distillation failure must never break rotation.
    try {
      await appendEpisodes(memDir, distillEpisodes(archive));
    } catch (episodeErr) {
      console.error('[TranscriptLogger] episode distillation failed:', episodeErr);
    }

    // Write-then-rename so a crash mid-rotation never truncates the live file.
    const tmpPath = `${filePath}.rotating`;
    await fs.promises.writeFile(tmpPath, keep, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
    console.info(`[TranscriptLogger] rotated ${archive.length} bytes into ${path.basename(archivePath)}`);
  } catch (err) {
    console.error('[TranscriptLogger] rotation failed:', err);
  }
}

function rememberLoggedKey(key: string): void {
  loggedKeys.add(key);
  if (loggedKeys.size > MAX_LOGGED_KEYS) {
    // Drop the oldest half (Set preserves insertion order).
    let i = 0;
    for (const k of loggedKeys) {
      loggedKeys.delete(k);
      if (++i >= MAX_LOGGED_KEYS / 2) break;
    }
  }
}

async function resolveWorkspace(conversation_id: string): Promise<string | null> {
  if (workspaceCache.has(conversation_id)) return workspaceCache.get(conversation_id) ?? null;
  let workspace: string | null = null;
  try {
    const db = await getDatabase();
    const conv = db.getConversation(conversation_id);
    const extra = conv.success ? (conv.data?.extra as { workspace?: string } | undefined) : undefined;
    if (extra?.workspace && typeof extra.workspace === 'string') {
      workspace = extra.workspace;
    }
  } catch {
    workspace = null;
  }
  workspaceCache.set(conversation_id, workspace);
  return workspace;
}

/**
 * The archive only scans project roots listed in `~/.ijfw/registry.md`, so a
 * workspace that gained its first transcript entry is appended there (format:
 * `<path> | <hash> | <ISO8601>`) to make it visible on the Memory page.
 */
async function ensureRegistered(workspace: string): Promise<void> {
  const norm = path.resolve(workspace);
  if (registryEnsured.has(norm)) return;
  registryEnsured.add(norm);
  try {
    const ijfwDir = path.join(os.homedir(), '.ijfw');
    const registryPath = path.join(ijfwDir, 'registry.md');
    let content = '';
    try {
      content = await fs.promises.readFile(registryPath, 'utf8');
    } catch {
      // registry does not exist yet
    }
    const listed = content.split('\n').some((line) => {
      const first = line.split('|')[0]?.trim();
      return first && path.resolve(first) === norm;
    });
    if (listed) return;
    await fs.promises.mkdir(ijfwDir, { recursive: true });
    const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    await fs.promises.appendFile(registryPath, `${suffix}${norm} | - | ${new Date().toISOString()}\n`, 'utf8');
  } catch (err) {
    console.error('[TranscriptLogger] registry update failed:', err);
  }
}

function appendSerialized(filePath: string, op: () => Promise<void>): Promise<void> {
  const prev = appendChains.get(filePath) ?? Promise.resolve();
  const next = prev.then(op).catch((err) => {
    console.error('[TranscriptLogger] append failed:', err);
  });
  appendChains.set(filePath, next);
  return next;
}
