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
  const summary = JSON.stringify(singleLine(`${described.label}: ${stripLabelPrefix(described.body)}`, 100));
  const convTag = `conv-${conversation_id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'unknown'}`;
  const body = truncate(sanitizeBody(described.body), MAX_BODY_CHARS);

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
