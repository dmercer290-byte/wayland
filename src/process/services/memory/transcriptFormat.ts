/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure formatting for transcript memory blocks (no electron/db imports so it
 * stays unit-testable). transcriptLogger.ts owns the write/side-effect path.
 */

import type { TMessage } from '@/common/chat/chatLib';

/** Bound each transcript block body. */
const MAX_BODY_CHARS = 4000;

/** Message types mirrored into the transcript, mapped to a kind tag. */
export const TRANSCRIPT_KIND_BY_TYPE: Record<string, 'chat' | 'tool-call' | 'thought'> = {
  text: 'chat',
  thinking: 'thought',
  tool_call: 'tool-call',
  tool_group: 'tool-call',
  acp_tool_call: 'tool-call',
  codex_tool_call: 'tool-call',
};

/**
 * Redact secret-looking strings before anything hits disk. Transcripts mirror
 * raw tool args/results, which routinely carry API keys and tokens; a memory
 * file that gets backed up or shared must never leak them. Patterns cover the
 * common provider key shapes plus a generic `key: value` assignment form.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI / Anthropic style
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google API key
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, // Authorization headers
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}/g, // JWTs
];

/** `"api_key": "..."` / `token=...` style assignments, value redacted. */
const SECRET_ASSIGNMENT =
  /(["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|token)["']?\s*[:=]\s*["']?)([^"'\s,}]{8,})/gi;

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  out = out.replace(SECRET_ASSIGNMENT, '$1[REDACTED]');
  return out;
}

/** File header re-written on every rotation. */
export const TRANSCRIPT_HEADER = '<!-- ijfw-schema: v1 -->\n# Session Transcript\n\n';

/**
 * Split transcript content for rotation: returns the newest whole blocks that
 * fit in `keepBytes` (to remain in transcript.md) and the older remainder (to
 * be gzip-archived). Splits only on block starts (`\n---\n` following a block
 * body) so both halves stay parseable. Pure - exported for tests.
 */
export function splitTranscriptForRotation(content: string, keepBytes: number): { keep: string; archive: string } {
  const body = content.startsWith(TRANSCRIPT_HEADER) ? content.slice(TRANSCRIPT_HEADER.length) : content;
  // Block boundaries: a `---` line that begins a frontmatter section always
  // follows a blank line in our writer's output ("\n\n---\n").
  const marker = '\n\n---\n';
  if (body.length <= keepBytes) return { keep: TRANSCRIPT_HEADER + body, archive: '' };

  let cut = body.indexOf(marker);
  let lastGood = -1;
  while (cut !== -1) {
    if (body.length - (cut + 2) <= keepBytes) {
      lastGood = cut + 2; // keep from the `---` line (skip the blank separator)
      break;
    }
    cut = body.indexOf(marker, cut + marker.length);
  }
  if (lastGood === -1) {
    // No boundary leaves a small-enough tail - keep everything (better a
    // slightly oversized file than a torn block).
    return { keep: TRANSCRIPT_HEADER + body, archive: '' };
  }
  return {
    keep: TRANSCRIPT_HEADER + body.slice(lastGood),
    archive: body.slice(0, lastGood),
  };
}

/** Body lines that are exactly `---` would split the block - soften them. */
function sanitizeBody(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() === '---' ? '—' : line))
    .join('\n');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}

function singleLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function safeJson(value: unknown): string {
  try {
    return truncate(JSON.stringify(value, null, 2), 1200);
  } catch {
    return '(unserializable)';
  }
}

function describeMessage(message: TMessage): { label: string; body: string } | null {
  switch (message.type) {
    case 'text': {
      const role = message.position === 'right' ? 'User' : 'Assistant';
      const content = typeof message.content?.content === 'string' ? message.content.content : '';
      if (!content.trim()) return null;
      return { label: role, body: content };
    }
    case 'thinking': {
      const content = typeof message.content?.content === 'string' ? message.content.content : '';
      if (!content.trim()) return null;
      const subject = message.content?.subject ? `**${message.content.subject}**\n\n` : '';
      return { label: 'Thinking', body: `${subject}${content}` };
    }
    case 'tool_call': {
      const { name, args, error, status } = message.content ?? {};
      if (!name) return null;
      const lines = [`**Tool:** ${name}`];
      if (args && Object.keys(args).length > 0) {
        lines.push('', '```json', safeJson(args), '```');
      }
      if (status) lines.push('', `**Status:** ${status}`);
      if (error) lines.push('', `**Error:** ${error}`);
      return { label: `Tool call: ${name}`, body: lines.join('\n') };
    }
    case 'tool_group': {
      const calls = Array.isArray(message.content) ? message.content : [];
      if (calls.length === 0) return null;
      const lines: string[] = [];
      for (const call of calls) {
        lines.push(`**Tool:** ${call.name} — ${call.status}`);
        if (call.description) lines.push(`  ${singleLine(call.description, 300)}`);
        if (typeof call.resultDisplay === 'string' && call.resultDisplay.trim()) {
          lines.push('', '```', truncate(call.resultDisplay, 1000), '```');
        }
        lines.push('');
      }
      const names = calls.map((c) => c.name).join(', ');
      return { label: `Tool call: ${names}`, body: lines.join('\n') };
    }
    case 'acp_tool_call': {
      const update = message.content?.update;
      if (!update) return null;
      const title = update.title || update.kind || 'tool';
      const lines = [`**Tool:** ${title}`];
      if (update.status) lines.push('', `**Status:** ${update.status}`);
      if (update.rawInput && Object.keys(update.rawInput).length > 0) {
        lines.push('', '```json', safeJson(update.rawInput), '```');
      }
      return { label: `Tool call: ${title}`, body: lines.join('\n') };
    }
    case 'codex_tool_call': {
      const content = message.content;
      if (!content) return null;
      const title = content.title || content.subtype || content.kind || 'tool';
      const lines = [`**Tool:** ${title}`];
      if (content.status) lines.push('', `**Status:** ${content.status}`);
      return { label: `Tool call: ${title}`, body: lines.join('\n') };
    }
    default:
      return null;
  }
}

/** Summary should not repeat a leading "**Tool:** name" markdown fragment verbatim. */
function stripLabelPrefix(body: string): string {
  return body.replace(/^\*\*(Tool|Thinking):\*\*\s*/, '');
}

/**
 * Format one message as an IJFW memory block compatible with
 * `parseMarkdownBlocks`. Returns '' for messages with nothing worth logging.
 */
export function formatTranscriptBlock(conversation_id: string, message: TMessage): string {
  const kind = TRANSCRIPT_KIND_BY_TYPE[message.type];
  const described = describeMessage(message);
  if (!kind || !described) return '';

  const storedAt = new Date(message.createdAt ?? Date.now()).toISOString();
  const redactedBody = redactSecrets(described.body);
  const summary = JSON.stringify(singleLine(`${described.label}: ${stripLabelPrefix(redactedBody)}`, 100));
  const convTag = `conv-${conversation_id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'unknown'}`;
  const body = truncate(sanitizeBody(redactedBody), MAX_BODY_CHARS);

  return [
    '---',
    'type: session',
    `summary: ${summary}`,
    `stored: ${storedAt}`,
    `tags: [transcript, ${kind}, ${convTag}]`,
    '---',
    body,
    '',
    '',
  ].join('\n');
}
