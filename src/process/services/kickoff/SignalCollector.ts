/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationRepository } from '@process/services/database/IConversationRepository';
import type { CronService } from '@process/services/cron/CronService';
import type { ITeamCrudRepository } from '@process/team/repository/ITeamRepository';
import { ExtensionRegistry } from '@process/extensions/ExtensionRegistry';
import { getInstallUuid } from './installUuid';
import { timeBucketFor } from './seededShuffle';
import { RITUAL_RECENT_WINDOW_MS, type KickoffSignals } from './types';

/**
 * Pure main-process signal reader for the Kickoff SuggestionEngine.
 *
 * Direct fix from cross-audit dealbreaker #5 (architecture): the engine
 * MUST NOT call any renderer hook. SignalCollector reads conversation
 * repo, cron service, team repo, and ConfigStorage directly and returns
 * a typed snapshot for the engine to walk.
 *
 * Errors are swallowed per-source and substituted with safe defaults so a
 * single failure (e.g. DB busy) degrades the engine to "no Standing
 * signal" rather than blocking the suggest IPC entirely.
 */
export class SignalCollector {
  constructor(
    private readonly conversationRepo: IConversationRepository,
    private readonly cronService: CronService,
    private readonly teamRepo: ITeamCrudRepository,
    private readonly userIdProvider: () => string = () => 'default'
  ) {}

  async collect(assistantId: string, now: number = Date.now()): Promise<KickoffSignals> {
    const installUuid = await getInstallUuid();
    const timeBucket = timeBucketFor(now);

    const [recentConvs, ritualFired] = await Promise.all([
      this.collectRecentConversations(assistantId).catch(
        (): KickoffSignals['assistantRecentConversations'] => []
      ),
      this.detectRecentRitualOutput(assistantId, now).catch((): boolean => false),
    ]);

    return {
      now,
      timeBucket,
      installUuid,
      assistantRecentConversations: recentConvs,
      hasStandingRitualFiredRecently: ritualFired,
    };
  }

  private async collectRecentConversations(assistantId: string): Promise<KickoffSignals['assistantRecentConversations']> {
    const page = await this.conversationRepo.getUserConversations(undefined, 0, 50);
    const matches = page.data.filter((conv) => {
      const presetId = (conv.extra as { presetAssistantId?: string } | undefined)?.presetAssistantId;
      return presetId === assistantId || presetId === stripExtPrefix(assistantId);
    });
    matches.sort((a, b) => b.modifyTime - a.modifyTime);

    const out: KickoffSignals['assistantRecentConversations'] = [];
    for (const conv of matches.slice(0, 5)) {
      let messageCount = 0;
      let durationMs = 0;
      try {
        const messagesPage = await this.conversationRepo.getMessages(conv.id, 0, 100);
        messageCount = messagesPage.data.length;
        if (messageCount >= 2) {
          const first = messagesPage.data[0];
          const last = messagesPage.data[messageCount - 1];
          const firstMs = numericTimestamp(first);
          const lastMs = numericTimestamp(last);
          if (firstMs !== null && lastMs !== null) {
            durationMs = Math.abs(lastMs - firstMs);
          }
        }
      } catch {
        // Best-effort — empty conversation just fails the quality gate.
      }
      out.push({
        id: conv.id,
        modifyTime: conv.modifyTime,
        messageCount,
        durationMs,
        subject: conv.name ?? '',
        isAutoTitled: isAutoTitled(conv.name ?? ''),
      });
    }
    return out;
  }

  /**
   * "Recent ritual output" = a cron job created by a Standing-Company
   * ritual scheduler for a team whose sourceLauncherId matches this
   * assistant, where the job's last execution succeeded within the window.
   *
   * The ritualScheduler tags every ritual cron with `createdBy: 'agent'`
   * and attaches it to the leader's conversationId, so we don't need a new
   * event-log table to detect "fired" — the cron job's own state row
   * carries lastRunAtMs + lastStatus.
   */
  private async detectRecentRitualOutput(assistantId: string, now: number): Promise<boolean> {
    const userId = this.userIdProvider();
    const teams = await this.teamRepo.findAll(userId);
    const unprefixed = stripExtPrefix(assistantId);
    // Standing-company gate: either user-promoted via TeamSessionService or
    // bundle-marked Standing at creation time. Both install ritual crons via
    // CronRitualScheduler so either is a valid source of "ritual output."
    const standingTeams = teams.filter(
      (t) => t.promotedToStanding === true && (t.sourceLauncherId === assistantId || t.sourceLauncherId === unprefixed)
    );
    if (standingTeams.length === 0) return false;

    for (const team of standingTeams) {
      const leader = team.agents.find((a) => a.role === 'leader');
      if (!leader?.conversationId) continue;
      const jobs = await this.cronService.listJobsByConversation(leader.conversationId);
      const ritualJobs = jobs.filter((j) => j.metadata.createdBy === 'agent');
      for (const job of ritualJobs) {
        const lastRun = job.state.lastRunAtMs;
        if (lastRun !== undefined && job.state.lastStatus === 'ok' && now - lastRun <= RITUAL_RECENT_WINDOW_MS) {
          return true;
        }
      }
    }
    return false;
  }
}

/**
 * Look up the registry record for `assistantId`. Used by SuggestionEngine
 * to pull the per-assistant kickoff array. Co-located here because both
 * the engine and the bridge need it and the registry's public API only
 * exposes `getAssistants()` (raw record array).
 */
export function findAssistantInRegistry(assistantId: string): Record<string, unknown> | null {
  try {
    const registry = ExtensionRegistry.getInstance();
    const all = registry.getAssistants();
    const unprefixed = stripExtPrefix(assistantId);
    return (
      all.find((a) => {
        const id = (a as { id?: unknown }).id;
        return typeof id === 'string' && (id === assistantId || id === unprefixed || stripExtPrefix(id) === unprefixed);
      }) ?? null
    );
  } catch {
    return null;
  }
}

export function stripExtPrefix(id: string): string {
  return id.startsWith('ext-') ? id.slice(4) : id;
}

const AUTO_TITLE_PATTERNS = [/^new conversation/i, /^untitled/i, /^chat \d+/i, /^new chat/i];
function isAutoTitled(subject: string): boolean {
  const trimmed = subject.trim();
  if (!trimmed) return true;
  return AUTO_TITLE_PATTERNS.some((re) => re.test(trimmed));
}

function numericTimestamp(message: { createdAt?: unknown; timestamp?: unknown }): number | null {
  const candidates: unknown[] = [message.createdAt, message.timestamp];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string') {
      const parsed = Date.parse(c);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}
