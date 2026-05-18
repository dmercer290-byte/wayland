// src/renderer/pages/team/hooks/useTeamSourceLauncher.ts
//
// Best-effort lookup of the bundle launcher that spawned this team. Used
// by W2c to surface launcher-only metadata (rituals + Standing badge) in
// the team page header + right rail.
//
// Match strategy: case-insensitive name compare against the launcher's
// localized name (falling back to en-US, then `launcher.name`). The team
// schema does not persist a back-reference to its source launcher today —
// if the user has renamed the team since launch the lookup quietly
// returns `null` and the caller renders the no-launcher fallback.
//
// Documented follow-up: persist `team.sourceLauncherId` at create-time
// so we can stop name-matching. Tracked alongside the W3a roster live-edit.

import { useMemo } from 'react';
import type { AssistantListItem } from '@/renderer/pages/settings/AssistantSettings/types';
import { useAssistantList } from '@/renderer/hooks/assistant';

export type UseTeamSourceLauncherResult = {
  launcher: AssistantListItem | null;
};

const resolveLauncherName = (launcher: AssistantListItem, localeKey: string): string => {
  const localized = launcher.nameI18n?.[localeKey];
  if (localized) return localized;
  const en = launcher.nameI18n?.['en-US'];
  if (en) return en;
  return launcher.name ?? '';
};

export const useTeamSourceLauncher = (teamName: string): UseTeamSourceLauncherResult => {
  const { assistants, localeKey } = useAssistantList();

  const launcher = useMemo<AssistantListItem | null>(() => {
    if (!teamName) return null;
    const needle = teamName.trim().toLowerCase();
    if (!needle) return null;
    for (const a of assistants) {
      if (a._kind !== 'team') continue;
      const resolved = resolveLauncherName(a, localeKey).trim().toLowerCase();
      if (resolved && resolved === needle) return a;
    }
    return null;
  }, [assistants, localeKey, teamName]);

  return { launcher };
};
