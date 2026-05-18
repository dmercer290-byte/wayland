// src/renderer/pages/team/components/TeamHeaderBadges.tsx
//
// W2c — Header badge cluster for the team page:
//   - Standing badge (purple dot + "Standing") when the team's source
//     launcher is in the locked Standing set
//   - Backend rollup ("3 × Claude, 2 × Gemini") computed from team.agents
//     grouped by agentType
//
// Source launcher resolution is best-effort via useTeamSourceLauncher.
// If we can't match a launcher we just omit the Standing badge — the
// rollup still renders because it derives from `agents` directly.

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssistantListItem } from '@/renderer/pages/settings/AssistantSettings/types';
import type { TeamAgent } from '@/common/types/teamTypes';
import { getBackendLabel } from '@renderer/utils/model/backendLabel';

type Props = {
  agents: TeamAgent[];
  launcher: AssistantListItem | null;
};

const TeamHeaderBadges: React.FC<Props> = ({ agents, launcher }) => {
  const { t } = useTranslation();
  const isStanding = launcher?._standing === true;

  const rollupText = useMemo(() => {
    if (agents.length === 0) return '';
    const counts = new Map<string, number>();
    for (const a of agents) {
      counts.set(a.agentType, (counts.get(a.agentType) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([type, count]) => `${count} × ${getBackendLabel(type)}`)
      .join(', ');
  }, [agents]);

  return (
    <div data-testid='team-header-badges' className='flex items-center gap-8px'>
      {isStanding && (
        <span
          data-testid='team-header-standing-badge'
          className='inline-flex items-center gap-4px px-6px py-2px rd-4px text-10px font-medium uppercase tracking-wider'
          style={{
            background: 'color-mix(in srgb, var(--color-primary-6) 12%, transparent)',
            color: 'var(--color-primary-6)',
          }}
        >
          <span
            className='w-1.5 h-1.5 rd-full inline-block'
            style={{ background: 'var(--color-primary-6)' }}
            aria-hidden='true'
          />
          {t('teams.standingBadge', { defaultValue: 'Standing' })}
        </span>
      )}
      {rollupText && (
        <span
          data-testid='team-header-backend-rollup'
          className='text-11px text-[color:var(--color-text-3)] whitespace-nowrap'
        >
          {rollupText}
        </span>
      )}
    </div>
  );
};

export default TeamHeaderBadges;
