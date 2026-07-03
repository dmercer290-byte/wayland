/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * transcriptLogger block formatting - the emitted blocks must round-trip
 * through the same parser the Memory archive uses (parseMarkdownBlocks),
 * with type/summary/stored/tags intact and bodies that cannot split blocks.
 */

import { describe, expect, it } from 'vitest';

import type { IMessageText, IMessageThinking, IMessageToolCall, TMessage } from '@/common/chat/chatLib';
import { parseMarkdownBlocks } from '@/process/services/memory/markdownFrontmatter';
import {
  TRANSCRIPT_HEADER,
  formatTranscriptBlock,
  redactSecrets,
  splitTranscriptForRotation,
} from '@/process/services/memory/transcriptFormat';

const CONV = 'conv-1234-abcd';

const textMessage = (content: string, position: 'left' | 'right'): IMessageText =>
  ({
    id: 'm1',
    conversation_id: CONV,
    type: 'text',
    position,
    createdAt: 1751500000000,
    content: { content },
  }) as IMessageText;

describe('formatTranscriptBlock', () => {
  it('formats a user chat message as a parseable session block', () => {
    const block = formatTranscriptBlock(CONV, textMessage('Fix the login bug please', 'right'));
    const parsed = parseMarkdownBlocks(block);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].frontmatter['type']).toBe('session');
    expect(parsed[0].frontmatter['summary']).toContain('User: Fix the login bug');
    expect(parsed[0].frontmatter['tags']).toEqual(['transcript', 'chat', 'conv-conv-1234-abcd'.slice(0, 17)]);
    expect(parsed[0].body).toContain('Fix the login bug please');
  });

  it('labels assistant messages by position', () => {
    const block = formatTranscriptBlock(CONV, textMessage('Here is the fix.', 'left'));
    const parsed = parseMarkdownBlocks(block);
    expect(parsed[0].frontmatter['summary']).toContain('Assistant:');
  });

  it('formats thinking messages with the thought tag', () => {
    const msg = {
      id: 'm2',
      conversation_id: CONV,
      type: 'thinking',
      createdAt: 1751500000000,
      content: { content: 'The bug is in the auth flow.', status: 'done' },
    } as IMessageThinking;
    const block = formatTranscriptBlock(CONV, msg);
    const parsed = parseMarkdownBlocks(block);
    expect(parsed[0].frontmatter['tags']).toContain('thought');
    expect(parsed[0].body).toContain('auth flow');
  });

  it('formats tool calls with name, args, and status', () => {
    const msg = {
      id: 'm3',
      conversation_id: CONV,
      type: 'tool_call',
      createdAt: 1751500000000,
      content: { callId: 'c1', name: 'read_file', args: { path: '/tmp/x' }, status: 'success' },
    } as IMessageToolCall;
    const block = formatTranscriptBlock(CONV, msg);
    const parsed = parseMarkdownBlocks(block);
    expect(parsed[0].frontmatter['tags']).toContain('tool-call');
    expect(parsed[0].frontmatter['summary']).toContain('read_file');
    expect(parsed[0].body).toContain('"path": "/tmp/x"');
    expect(parsed[0].body).toContain('**Status:** success');
  });

  it('sanitizes --- lines in bodies so blocks cannot split', () => {
    const block = formatTranscriptBlock(CONV, textMessage('before\n---\nafter', 'right'));
    const parsed = parseMarkdownBlocks(block);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].body).toContain('before');
    expect(parsed[0].body).toContain('after');
  });

  it('returns empty string for empty or unsupported messages', () => {
    expect(formatTranscriptBlock(CONV, textMessage('   ', 'right'))).toBe('');
    const tips = { id: 't', conversation_id: CONV, type: 'tips', content: { content: 'x', type: 'error' } } as TMessage;
    expect(formatTranscriptBlock(CONV, tips)).toBe('');
  });

  it('keeps summaries single-line and bounded', () => {
    const long = 'a line\nwith breaks '.repeat(50);
    const block = formatTranscriptBlock(CONV, textMessage(long, 'right'));
    const parsed = parseMarkdownBlocks(block);
    const summary = parsed[0].frontmatter['summary'];
    expect(typeof summary).toBe('string');
    expect((summary as string).includes('\n')).toBe(false);
    expect((summary as string).length).toBeLessThanOrEqual(110);
  });

  it('redacts secrets in bodies and summaries', () => {
    const leaky = 'my key is sk-abc123def456ghi789jkl and token=supersecretvalue123 plus ghp_' + 'a'.repeat(30);
    const block = formatTranscriptBlock(CONV, textMessage(leaky, 'right'));
    expect(block).not.toContain('sk-abc123def456ghi789jkl');
    expect(block).not.toContain('supersecretvalue123');
    expect(block).not.toContain('ghp_' + 'a'.repeat(30));
    expect(block).toContain('[REDACTED]');
  });

  it('appended blocks parse as consecutive entries', () => {
    const file =
      '<!-- ijfw-schema: v1 -->\n# Session Transcript\n\n' +
      formatTranscriptBlock(CONV, textMessage('first', 'right')) +
      formatTranscriptBlock(CONV, textMessage('second', 'left'));
    const parsed = parseMarkdownBlocks(file);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].body).toContain('first');
    expect(parsed[1].body).toContain('second');
  });
});

describe('redactSecrets', () => {
  it('masks provider keys, JWTs, and bearer tokens', () => {
    const input = [
      'openai: sk-proj1234567890abcdefgh',
      'aws: AKIAIOSFODNN7EXAMPLE',
      'slack: xoxb-1234567890-abcdefghij',
      'google: AIzaSyA1234567890abcdefghijklmnopqrstu',
      'jwt: eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      'Authorization: Bearer abcdef1234567890abcdef',
    ].join('\n');
    const out = redactSecrets(input);
    expect(out).not.toMatch(/sk-proj|AKIAIOSFODNN7|xoxb-123|AIzaSy|eyJhbGciOiJI|Bearer abcdef/);
    expect(out.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('masks key:value assignments but keeps ordinary text', () => {
    const out = redactSecrets('"api_key": "abcd1234efgh5678" and the weather is nice today');
    expect(out).toContain('"api_key": "[REDACTED]');
    expect(out).toContain('weather is nice today');
  });
});

describe('splitTranscriptForRotation', () => {
  const block = (n: number, pad: number): string =>
    [
      '---',
      'type: session',
      `summary: "entry ${n}"`,
      'stored: 2026-07-03T00:00:00.000Z',
      'tags: [transcript, chat]',
      '---',
      `body ${n} ${'x'.repeat(pad)}`,
      '',
      '',
    ].join('\n');

  it('keeps everything when under the cap', () => {
    const content = TRANSCRIPT_HEADER + block(1, 10) + block(2, 10);
    const { keep, archive } = splitTranscriptForRotation(content, 10_000);
    expect(archive).toBe('');
    expect(keep).toBe(content);
  });

  it('splits on block boundaries, newest blocks kept, both halves parseable', () => {
    const blocks = Array.from({ length: 20 }, (_, i) => block(i, 500));
    const content = TRANSCRIPT_HEADER + blocks.join('');
    const { keep, archive } = splitTranscriptForRotation(content, 2000);
    expect(archive.length).toBeGreaterThan(0);
    const keptEntries = parseMarkdownBlocks(keep);
    const archivedEntries = parseMarkdownBlocks(archive);
    expect(keptEntries.length + archivedEntries.length).toBe(20);
    // Newest entries stay live; oldest go to the archive.
    expect(archivedEntries[0].frontmatter['summary']).toBe('entry 0');
    expect(keptEntries[keptEntries.length - 1].frontmatter['summary']).toBe('entry 19');
    expect(keep.startsWith(TRANSCRIPT_HEADER)).toBe(true);
  });

  it('never tears a block even when a single block exceeds the cap', () => {
    const content = TRANSCRIPT_HEADER + block(1, 5000);
    const { keep, archive } = splitTranscriptForRotation(content, 100);
    expect(archive).toBe('');
    expect(parseMarkdownBlocks(keep)).toHaveLength(1);
  });
});
