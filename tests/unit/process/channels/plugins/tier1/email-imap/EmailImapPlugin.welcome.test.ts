/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Email can initiate a thread by messaging its own inbox, so it exposes a
 * non-null getSelfTarget() (its imap user) and keys the once-per-account
 * welcome marker on that same address. This is the email half of the
 * generalized welcome handshake.
 */

import { describe, expect, it } from 'vitest';

import { EmailImapPlugin } from '@process/channels/plugins/tier1/email-imap/EmailImapPlugin';
import type { IChannelPluginConfig } from '@process/channels/types';

function configFor(imapUser: string): IChannelPluginConfig {
  return {
    id: 'email-imap_default',
    type: 'email-imap',
    name: 'Email',
    enabled: true,
    status: 'created',
    createdAt: 0,
    updatedAt: 0,
    credentials: {
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser,
      imapPassword: 'app-password',
      imapTls: true,
      useSameAuth: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpTls: true,
    },
  };
}

describe('EmailImapPlugin - welcome self target', () => {
  it('returns null self target / account identity before initialize', () => {
    const plugin = new EmailImapPlugin();
    expect(plugin.getSelfTarget()).toBeNull();
    expect(plugin.getAccountIdentity()).toBeNull();
  });

  it('resolves the inbox address as self target + account identity', async () => {
    const plugin = new EmailImapPlugin();
    await plugin.initialize(configFor('agent@example.com'));
    expect(plugin.getSelfTarget()).toBe('agent@example.com');
    expect(plugin.getAccountIdentity()).toBe('agent@example.com');
  });
});
