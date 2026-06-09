/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression guard for the imapflow fetch-lock deadlock: messageFlagsAdd must
 * run ONCE after the fetch() generator is fully drained, never inside the
 * for-await. Calling another command mid-fetch deadlocks the connection (fetch
 * holds the lock the command waits for), which previously hung connect() right
 * after the first message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedCredentials } from '@process/channels/plugins/tier1/email-imap/EmailImapShared';

const { ImapFlowStub, fetchMessages, flagsAddCalls, fetchActive } = vi.hoisted(() => {
  type Raw = { uid: number; envelope: unknown; source: Buffer };
  const fetchMessages: Raw[] = [];
  const flagsAddCalls: Array<{ uids: string; duringFetch: boolean }> = [];
  const fetchActive = { value: false };

  function makeEmitter() {
    const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
    return {
      on(event: string, cb: (...a: unknown[]) => void) {
        (listeners[event] ??= []).push(cb);
        return this;
      },
      off() {
        return this;
      },
      emit() {
        return false;
      },
    };
  }

  class ImapFlowStub {
    constructor(_opts: unknown) {
      const fake = Object.assign(makeEmitter(), {
        connect: vi.fn(async () => undefined),
        mailboxOpen: vi.fn(async () => undefined),
        idle: vi.fn(() => new Promise<void>(() => undefined)),
        logout: vi.fn(async () => undefined),
        serverInfo: { capability: ['IDLE'] },
        fetch: vi.fn(() => {
          fetchActive.value = true;
          return {
            async *[Symbol.asyncIterator]() {
              for (const m of fetchMessages) yield m;
              fetchActive.value = false; // generator exhausted, lock released
            },
          };
        }),
        messageFlagsAdd: vi.fn(async (uids: string) => {
          flagsAddCalls.push({ uids, duringFetch: fetchActive.value });
        }),
      });
      return fake as unknown as ImapFlowStub;
    }
  }

  return { ImapFlowStub, fetchMessages, flagsAddCalls, fetchActive };
});

vi.mock('imapflow', () => ({ ImapFlow: ImapFlowStub }));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn(), close: vi.fn() })) },
}));

import { EmailImapConnection } from '@process/channels/plugins/tier1/email-imap/EmailImapConnection';

function makeCreds(): ResolvedCredentials {
  return {
    imap: { host: 'imap.example.com', port: 993, user: 'a@b', password: 'pw', tls: true },
    smtp: { host: 'imap.example.com', port: 587, user: 'a@b', password: 'pw', tls: true },
  };
}

function makeRaw(uid: number, addr: string) {
  return {
    uid,
    envelope: { messageId: `<m${uid}>`, from: [{ address: addr }], subject: 's' },
    source: Buffer.from('body'),
  };
}

describe('EmailImapConnection - fetch drain marks seen after iteration', () => {
  beforeEach(() => {
    fetchMessages.length = 0;
    flagsAddCalls.length = 0;
    fetchActive.value = false;
  });
  afterEach(() => vi.restoreAllMocks());

  it('emits every message and marks all seen in ONE post-iteration command', async () => {
    fetchMessages.push(makeRaw(1, 'x@y.com'), makeRaw(2, 'z@y.com'));

    const seen: string[] = [];
    const conn = new EmailImapConnection((m) => seen.push(m.chatId));
    await conn.connect(makeCreds());

    // Both messages delivered.
    expect(seen).toEqual(['x@y.com', 'z@y.com']);

    // messageFlagsAdd called exactly once, with both UIDs, AFTER the generator
    // drained (never while the fetch lock was held).
    expect(flagsAddCalls).toHaveLength(1);
    expect(flagsAddCalls[0]!.uids).toBe('1,2');
    expect(flagsAddCalls[0]!.duringFetch).toBe(false);

    await conn.stop();
  });

  it('connect resolves even when unseen messages are present', async () => {
    fetchMessages.push(makeRaw(1, 'x@y.com'));
    const conn = new EmailImapConnection(() => undefined);
    // The bug made this hang forever; a passing test proves connect() returns.
    await expect(conn.connect(makeCreds())).resolves.toBeUndefined();
    await conn.stop();
  });
});
