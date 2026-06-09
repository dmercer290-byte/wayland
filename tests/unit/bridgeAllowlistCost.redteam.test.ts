import { describe, it, expect } from 'vitest';
import { isAllowedForRemote } from '@/common/adapter/bridgeAllowlist';

/**
 * WS-D / R4: cost observability has no remote (paired-device WebSocket) view
 * today, so the ENTIRE cost.* namespace is denied to remote callers via the
 * `cost.` prefix. byConversation + series disclose per-conversation usage and a
 * fine-grained activity timeline; the WS-F budget mutations
 * (cost.upsertBudget / cost.deleteBudget) are write operations a paired WebUI
 * must never reach. The dispatcher receives each wire key as `subscribe-<key>`.
 */
describe('isAllowedForRemote - cost.* denied to remote callers', () => {
  const deniedKeys: ReadonlyArray<string> = [
    // Coarse aggregates (no remote cost view exists).
    'cost.summary',
    'cost.byModel',
    'cost.byBackend',
    'cost.byTeam',
    // Fine-grained / sensitive reads.
    'cost.byConversation',
    'cost.series',
    // Future WS-F budget mutations (denied now).
    'cost.upsertBudget',
    'cost.deleteBudget',
  ];

  it.each(deniedKeys)('denies %s for remote callers', (key) => {
    expect(isAllowedForRemote(`subscribe-${key}`)).toBe(false);
  });

  // The denylist must not leak to non-cost namespaces: a sibling read the
  // paired WebUI legitimately needs stays allowed (denylist, not whitelist).
  it('still allows a read-only sibling namespace for remote callers', () => {
    expect(isAllowedForRemote('subscribe-usage.queryFrequentlyUsedModels')).toBe(true);
  });
});
