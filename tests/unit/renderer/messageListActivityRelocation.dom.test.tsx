/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

/**
 * #252 rework behavioral guard: rendering the message-list switch for an
 * `activity` turn must produce the inline ActivityTimeline DOM (the rework
 * re-enabled inline observability). This renders the real MessageItem switch
 * through MessageList - with the heavy, non-pure deps (Virtuoso layout,
 * auto-scroll, contexts, ipc) stubbed - and asserts the activity message flows
 * through the switch (its wrapper row mounts) AND the unified timeline renders
 * with a humanized step label. A regression that re-disables the inline card
 * would fail here, where a source string-grep would not.
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { IMessageActivity, TMessage } from '@/common/chat/chatLib';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

// react-virtuoso has no layout engine in jsdom; render items inline so the
// MessageItem switch actually runs for each row.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) => (
    <div data-testid='virtuoso-root'>
      {data.map((item, i) => (
        <div key={i}>{itemContent(i, item)}</div>
      ))}
    </div>
  ),
}));

// The message stream the list renders. Controlled per test.
let messageList: TMessage[] = [];
vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => messageList,
}));

// Non-pure side-effect hooks / leaf components: stub to no-ops so the switch is
// the only thing exercised.
vi.mock('@/renderer/pages/conversation/Messages/useAutoScroll', () => ({
  useAutoScroll: () => ({
    virtuosoRef: { current: null },
    handleScrollerRef: () => {},
    handleScroll: () => {},
    handleAtBottomStateChange: () => {},
    handleFollowOutput: () => false as const,
    showScrollButton: false,
    scrollToBottom: () => {},
    hideScrollButton: () => {},
  }),
}));
vi.mock('@/renderer/hooks/file/useAutoPreviewOfficeFiles', () => ({
  useAutoPreviewOfficeFiles: () => {},
}));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => null,
}));
vi.mock('@/renderer/pages/guid/components/workflow/workflowViewMode', () => ({
  useWorkflowViewMode: () => ({ isWorkflow: false, mode: 'conversation' }),
}));
vi.mock('@/renderer/pages/conversation/Messages/components/SelectionReplyButton', () => ({
  default: () => null,
}));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, key: 'default' }),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { get: { invoke: vi.fn().mockResolvedValue(null) } },
  },
}));

import MessageList from '@/renderer/pages/conversation/Messages/MessageList';

const activity = (id: string): IMessageActivity => ({
  id,
  msg_id: `turn-${id}`,
  conversation_id: 'c1',
  type: 'activity',
  position: 'left',
  content: {
    turnId: `turn-${id}`,
    status: 'running',
    nodes: [{ id: 'n1', kind: 'tool', callId: 'n1', name: 'ReadFile', status: 'running', startTime: 1 }],
  },
});

describe('MessageList #252 rework: inline activity timeline (behavioral)', () => {
  it('renders the inline activity timeline for an activity turn', () => {
    messageList = [activity('a1')];
    render(<MessageList />);

    // The activity message flows through the switch: its wrapper row mounts...
    expect(screen.getByTestId('message-activity-left')).toBeTruthy();
    // ...AND the unified inline timeline now renders (rework re-enabled it).
    expect(screen.getByTestId('activity-timeline')).toBeTruthy();
    // A running node surfaces as a humanized step label ("Reading a file").
    expect(screen.getByText('Reading a file')).toBeTruthy();
  });
});
