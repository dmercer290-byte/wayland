// src/renderer/pages/team/components/TeamRightRail.tsx
//
// W2c — Right-rail surface inside the team page. Mockup §4:
//   - Teammates: avatar + name + role + backend (status dot)
//   - Workspace: placeholder list (real per-team workspace browser is
//     already in the workspace sider; the rail link is a thin pointer
//     for now — W2d may flesh this out alongside the cost meter)
//   - Rituals: rendered from the source launcher's `_rituals`. The team
//     record itself does not carry rituals, so we look up the launcher
//     by team name (best-effort — see useTeamSourceLauncher). When no
//     launcher resolves, the section renders empty with a hint.

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AssistantListItem } from '@/renderer/pages/settings/AssistantSettings/types';
import type { TeamAgent, TeammateStatus } from '@/common/types/teamTypes';
import { getAgentLogo } from '@renderer/utils/model/agentLogo';
import { getBackendLabel } from '@renderer/utils/model/backendLabel';

type Props = {
  agents: TeamAgent[];
  statusMap: Map<string, { status: TeammateStatus }>;
  launcher: AssistantListItem | null;
  workspacePath?: string;
};

const STATUS_DOT_COLOR: Record<TeammateStatus, string> = {
  pending: 'bg-gray-400',
  idle: 'bg-gray-400',
  active: 'bg-green-500',
  completed: 'bg-gray-400',
  failed: 'bg-red-500',
};

const initialsFromName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
};

const TeammateRow: React.FC<{
  agent: TeamAgent;
  status: TeammateStatus;
}> = ({ agent, status }) => {
  const { t } = useTranslation();
  // Inline avatar resolution: there are already 5 isImageAvatar copies in the
  // codebase. Per W3a opening commit task, we deliberately avoid adding a 6th
  // util and rely on the backend logo or initials fallback for the rail rows.
  const backendLogo = getAgentLogo(agent.agentType);
  const showLogo = Boolean(backendLogo);
  const roleLabel =
    agent.role === 'leader'
      ? t('teams.rightRail.roleLeader', { defaultValue: 'leader' })
      : t('teams.rightRail.roleSpecialist', { defaultValue: 'specialist' });
  const backend = getBackendLabel(agent.agentType);
  const dotClass = STATUS_DOT_COLOR[status] ?? STATUS_DOT_COLOR.idle;

  return (
    <div
      data-testid='team-right-rail-teammate'
      className='flex items-center justify-between py-6px px-8px rd-6px hover:bg-[color:var(--fill-2)] cursor-default'
    >
      <div className='flex items-center gap-8px min-w-0'>
        {showLogo ? (
          <img
            src={backendLogo!}
            alt={agent.agentType}
            className='w-24px h-24px rd-full object-contain bg-[color:var(--fill-2)] p-2px shrink-0'
          />
        ) : (
          <span
            className='w-24px h-24px rd-full flex items-center justify-center text-10px font-semibold bg-[color:var(--fill-2)] shrink-0'
            aria-hidden='true'
          >
            {initialsFromName(agent.agentName)}
          </span>
        )}
        <div className='min-w-0'>
          <div className='text-12.5px font-medium text-[color:var(--color-text-1)] truncate'>{agent.agentName}</div>
          <div className='text-10px text-[color:var(--color-text-4)] truncate'>
            {roleLabel} · {backend}
          </div>
        </div>
      </div>
      <span
        data-testid='team-right-rail-status-dot'
        data-status={status}
        className={`w-1.5 h-1.5 rd-full shrink-0 ${dotClass} ${status === 'active' ? 'animate-pulse' : ''}`}
        aria-label={status}
      />
    </div>
  );
};

const TeamRightRail: React.FC<Props> = ({ agents, statusMap, launcher, workspacePath }) => {
  const { t } = useTranslation();
  const rituals = launcher?._rituals ?? [];
  const hasWorkspace = Boolean(workspacePath && workspacePath.length > 0);

  return (
    <aside
      data-testid='team-right-rail'
      className='w-260px shrink-0 h-full flex flex-col overflow-y-auto border-l border-solid border-[color:var(--border-base)] bg-[color:var(--color-bg-2)] p-16px gap-16px'
    >
      <section data-testid='team-right-rail-teammates'>
        <div className='font-semibold text-11px text-[color:var(--color-text-3)] uppercase tracking-wider mb-8px'>
          {t('teams.rightRail.teammates', { defaultValue: 'Teammates' })}
        </div>
        <div className='flex flex-col gap-2px'>
          {agents.map((agent) => (
            <TeammateRow
              key={agent.slotId}
              agent={agent}
              status={statusMap.get(agent.slotId)?.status ?? agent.status}
            />
          ))}
        </div>
      </section>

      <section data-testid='team-right-rail-workspace'>
        <div className='font-semibold text-11px text-[color:var(--color-text-3)] uppercase tracking-wider mb-8px'>
          {t('teams.rightRail.workspace', { defaultValue: 'Workspace' })}
        </div>
        {hasWorkspace ? (
          <div className='text-11.5px text-[color:var(--color-text-3)] truncate' title={workspacePath}>
            {t('teams.rightRail.workspaceLinked', {
              defaultValue: 'Browse files in the workspace panel →',
            })}
          </div>
        ) : (
          <div className='text-11.5px text-[color:var(--color-text-4)] italic'>
            {t('teams.rightRail.workspaceEmpty', { defaultValue: 'No workspace bound to this team yet.' })}
          </div>
        )}
      </section>

      <section data-testid='team-right-rail-rituals'>
        <div className='font-semibold text-11px text-[color:var(--color-text-3)] uppercase tracking-wider mb-8px'>
          {t('teams.rightRail.rituals', { defaultValue: 'Rituals' })}
        </div>
        {rituals.length > 0 ? (
          <ul className='flex flex-col gap-4px text-11.5px text-[color:var(--color-text-3)] list-none m-0 p-0'>
            {rituals.map((ritual, i) => (
              <li key={`${ritual.name}-${i}`} className='flex items-baseline gap-6px'>
                <span className='text-[color:var(--color-text-4)]'>•</span>
                <span className='text-[color:var(--color-text-1)]'>{ritual.name}</span>
                <span className='text-[color:var(--color-text-4)] truncate'>— {ritual.cadence}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className='text-11.5px text-[color:var(--color-text-4)] italic'>
            {t('teams.rightRail.ritualsEmpty', { defaultValue: 'No rituals — not a Standing Company.' })}
          </div>
        )}
      </section>
    </aside>
  );
};

export default TeamRightRail;
