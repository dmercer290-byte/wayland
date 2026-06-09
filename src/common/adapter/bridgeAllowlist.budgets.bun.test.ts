// src/common/adapter/bridgeAllowlist.budgets.bun.test.ts
// Run with: bun test src/common/adapter/bridgeAllowlist.budgets.bun.test.ts
//
// R4 / Stage 1: assert every cost.* budget IPC key is denied to remote
// (paired-device WebSocket) callers. Budget mutations gate the local user's
// turns (pause action), so a remote caller creating an exceeded pause-budget
// could DoS the user; listBudgets / budgetAlert disclose spend. The whole
// cost.* namespace is denied by prefix - this locks that in against drift.

import { describe, it, expect } from 'bun:test';
import { isAllowedForRemote } from './bridgeAllowlist';

describe('bridgeAllowlist - cost budget keys are remote-denied', () => {
  const deniedKeys = [
    'cost.upsertBudget',
    'cost.deleteBudget',
    'cost.listBudgets',
    'cost.budgetAlert',
    // pre-existing cost reads also denied by the same prefix
    'cost.byConversation',
    'cost.series',
    'cost.summary',
  ];

  for (const key of deniedKeys) {
    it(`denies subscribe-${key}`, () => {
      expect(isAllowedForRemote(`subscribe-${key}`)).toBe(false);
    });
  }

  it('still allows a non-cost provider', () => {
    expect(isAllowedForRemote('subscribe-cron.list-jobs')).toBe(true);
  });
});
