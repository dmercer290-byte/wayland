/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { acpToActivityNodes } from '../../src/common/chat/activity/normalizers/acpNormalizer';
import type {
  AgentMessageChunkUpdate,
  AgentThoughtChunkUpdate,
  ToolCallUpdate,
  ToolCallUpdateStatus,
} from '../../src/common/types/acpTypes';

describe('acpToActivityNodes', () => {
  it('maps an in_progress tool_call to one running tool node (id + name)', () => {
    const evt: ToolCallUpdate = {
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-abc',
        status: 'in_progress',
        title: 'Read file',
        kind: 'read',
      },
    };

    const nodes = acpToActivityNodes(evt);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: 'call-abc',
      kind: 'tool',
      callId: 'call-abc',
      name: 'Read file',
      status: 'running',
    });
    // No timestamp on the ACP event -> none synthesized.
    expect(nodes[0].startTime).toBeUndefined();
    expect(nodes[0].endTime).toBeUndefined();
  });

  it('maps a pending tool_call to a running node too', () => {
    const evt: ToolCallUpdate = {
      sessionId: 'sess-1',
      update: { sessionUpdate: 'tool_call', toolCallId: 'call-p', status: 'pending', title: 'Edit', kind: 'edit' },
    };
    expect(acpToActivityNodes(evt)[0]).toMatchObject({ id: 'call-p', status: 'running' });
  });

  it('maps a completed tool_call_update to a done node with the SAME id (so it merges) and stringified detail', () => {
    const evt: ToolCallUpdateStatus = {
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-abc',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'file contents here' } }],
      },
    };

    const nodes = acpToActivityNodes(evt);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: 'call-abc', // same id as the tool_call above -> mergeNodeList folds in place
      kind: 'tool',
      callId: 'call-abc',
      status: 'done',
      detail: 'file contents here',
    });
  });

  it('maps a failed tool_call_update to a failed node', () => {
    const evt: ToolCallUpdateStatus = {
      sessionId: 'sess-1',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'call-x', status: 'failed' },
    };
    const nodes = acpToActivityNodes(evt);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: 'call-x', kind: 'tool', status: 'failed' });
  });

  it('maps an agent_thought_chunk to a thinking node with the text in detail', () => {
    const evt: AgentThoughtChunkUpdate = {
      sessionId: 'sess-9',
      update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Let me reason about this.' } },
    };

    const nodes = acpToActivityNodes(evt);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: 'thinking:sess-9',
      kind: 'thinking',
      name: '',
      status: 'running',
      detail: 'Let me reason about this.',
    });
  });

  it('keys thinking nodes by session id so consecutive chunks share one merge key', () => {
    const a: AgentThoughtChunkUpdate = {
      sessionId: 'sess-9',
      update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'A' } },
    };
    const b: AgentThoughtChunkUpdate = {
      sessionId: 'sess-9',
      update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'B' } },
    };
    expect(acpToActivityNodes(a)[0].id).toBe(acpToActivityNodes(b)[0].id);
  });

  it('returns [] for an agent_message_chunk (assistant answer prose, not activity)', () => {
    const evt: AgentMessageChunkUpdate = {
      sessionId: 'sess-1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The answer is 4.' } },
    };
    expect(acpToActivityNodes(evt)).toEqual([]);
  });

  it('returns [] for an unknown sessionUpdate type', () => {
    const evt = {
      sessionId: 'sess-1',
      update: { sessionUpdate: 'plan', entries: [] },
    } as unknown as Parameters<typeof acpToActivityNodes>[0];
    expect(acpToActivityNodes(evt)).toEqual([]);
  });

  it('returns [] (no throw) for malformed / empty objects', () => {
    const cases = [
      {},
      { update: null },
      { update: {} },
      { update: { sessionUpdate: 'tool_call' } }, // missing toolCallId
      { sessionId: 's', update: { sessionUpdate: 'tool_call_update' } }, // missing toolCallId
    ];
    for (const c of cases) {
      const fn = () => acpToActivityNodes(c as unknown as Parameters<typeof acpToActivityNodes>[0]);
      expect(fn).not.toThrow();
      expect(fn()).toEqual([]);
    }
  });

  it('defaults an odd/missing status on a tool_call_update to done', () => {
    const evt = {
      sessionId: 'sess-1',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'call-q', status: 'weird-value' },
    } as unknown as Parameters<typeof acpToActivityNodes>[0];
    expect(acpToActivityNodes(evt)[0]).toMatchObject({ id: 'call-q', status: 'done' });
  });
});
