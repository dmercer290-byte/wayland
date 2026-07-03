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
import { formatTranscriptBlock } from '@/process/services/memory/transcriptFormat';

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
