/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

/**
 * W2c — TeamRightRail DOM tests. Covers:
 *   - Teammate rows (avatar + name + role + backend + status dot)
 *   - Workspace placeholder (linked vs empty)
 *   - Rituals section (empty + populated)
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import type { AssistantListItem } from '@/renderer/pages/settings/AssistantSettings/types';
import type { TeamAgent } from '@/common/types/teamTypes';

import { vi } from 'vitest';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}));
vi.mock('@renderer/utils/model/agentLogo', () => ({
  getAgentLogo: (agentType: string) => (agentType === 'gemini' ? '/gemini.svg' : null),
}));

import TeamRightRail from '@/renderer/pages/team/components/TeamRightRail';

const makeAgent = (over: Partial<TeamAgent> = {}): TeamAgent => ({
  slotId: 'slot-1',
  conversationId: 'conv-1',
  role: 'teammate',
  agentType: 'gemini',
  agentName: 'Copy',
  conversationType: 'gemini',
  status: 'idle',
  ...over,
});

describe('TeamRightRail', () => {
  it('renders teammate rows with role, backend, and status dot', () => {
    const agents: TeamAgent[] = [
      makeAgent({ slotId: 's1', agentName: 'Marketing Lead', role: 'leader', agentType: 'claude' }),
      makeAgent({ slotId: 's2', agentName: 'Copy', role: 'teammate', agentType: 'gemini' }),
    ];
    const statusMap = new Map<string, { status: TeamAgent['status'] }>([
      ['s1', { status: 'active' }],
      ['s2', { status: 'idle' }],
    ]);

    render(<TeamRightRail agents={agents} statusMap={statusMap} launcher={null} workspacePath='' />);

    // Teammates section heading + both rows
    expect(screen.getByText('Teammates')).toBeTruthy();
    const rows = screen.getAllByTestId('team-right-rail-teammate');
    expect(rows).toHaveLength(2);

    // Status dots reflect the statusMap (active for leader, idle for teammate)
    const dots = screen.getAllByTestId('team-right-rail-status-dot');
    expect(dots[0].getAttribute('data-status')).toBe('active');
    expect(dots[1].getAttribute('data-status')).toBe('idle');

    // Role + backend caption
    expect(screen.getByText(/leader · claude/i)).toBeTruthy();
    expect(screen.getByText(/specialist · gemini/i)).toBeTruthy();

    // Gemini agent renders an avatar image (logo); claude has no logo in mock → initials
    const geminiAvatar = screen.getByAltText('gemini') as HTMLImageElement;
    expect(geminiAvatar.src).toContain('/gemini.svg');
    expect(screen.getByText('ML')).toBeTruthy(); // initials for "Marketing Lead"
  });

  it('renders the workspace placeholder (linked vs empty)', () => {
    const agents: TeamAgent[] = [makeAgent()];
    const statusMap = new Map();
    const { rerender } = render(
      <TeamRightRail agents={agents} statusMap={statusMap} launcher={null} workspacePath='' />
    );
    // Empty state
    expect(screen.getByText('No workspace bound to this team yet.')).toBeTruthy();

    // Linked state
    rerender(
      <TeamRightRail agents={agents} statusMap={statusMap} launcher={null} workspacePath='/tmp/myteam' />
    );
    expect(screen.getByText('Browse files in the workspace panel →')).toBeTruthy();
  });

  it('renders empty rituals section when the launcher carries no _rituals', () => {
    const agents: TeamAgent[] = [makeAgent()];
    render(<TeamRightRail agents={agents} statusMap={new Map()} launcher={null} workspacePath='' />);
    expect(screen.getByText('Rituals')).toBeTruthy();
    expect(screen.getByText('No rituals — not a Standing Company.')).toBeTruthy();
  });

  it('renders ritual entries from the source launcher', () => {
    const agents: TeamAgent[] = [makeAgent()];
    const launcher = {
      id: 'ext-marketing-agency',
      name: 'Marketing Agency',
      _standing: true,
      _rituals: [
        { name: 'Editorial standup', cadence: 'Mon 9am' },
        { name: 'Campaign retro', cadence: '1st of month' },
      ],
    } as unknown as AssistantListItem;

    render(<TeamRightRail agents={agents} statusMap={new Map()} launcher={launcher} workspacePath='' />);
    expect(screen.getByText('Editorial standup')).toBeTruthy();
    expect(screen.getByText('— Mon 9am')).toBeTruthy();
    expect(screen.getByText('Campaign retro')).toBeTruthy();
    expect(screen.getByText('— 1st of month')).toBeTruthy();
  });
});
