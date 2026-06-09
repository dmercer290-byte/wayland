/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure connection helpers shared between the main-process EmailImapPlugin and
 * the forked email worker (src/process/worker/emailImap.ts). Kept free of
 * imapflow/nodemailer/BasePlugin imports so it can be bundled into the worker
 * entry without dragging Electron-only code along.
 */

import type { ImapMessageEnvelope } from './EmailImapAdapter';

/**
 * Explicit, generous socket timeouts. The original main-thread plugin relied on
 * these to survive a busy event loop; in the worker the loop is no longer
 * starved, but the bounds still keep a genuinely unreachable host from spinning
 * forever instead of erroring.
 */
export const IMAP_TIMEOUTS = {
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  socketTimeout: 90_000,
} as const;

export type ResolvedCredentials = {
  readonly imap: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly tls: boolean;
  };
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly tls: boolean;
  };
};

export type ImapFetchMessage = {
  readonly uid: number;
  readonly envelope?: {
    readonly messageId?: string;
    readonly inReplyTo?: string;
    readonly subject?: string;
    readonly date?: Date;
    readonly from?: ReadonlyArray<{ readonly address?: string; readonly name?: string }>;
    readonly to?: ReadonlyArray<{ readonly address?: string; readonly name?: string }>;
  };
  readonly source?: Buffer;
};

/**
 * Turn an imapflow/socket error into a human-readable reason, so a failed
 * connect says WHY (auth rejected vs host unreachable) instead of the opaque
 * "Command failed" imapflow surfaces for a LOGIN that returns NO.
 */
export function describeImapError(err: unknown): string {
  const e = err as {
    authenticationFailed?: boolean;
    responseText?: string;
    serverResponseCode?: string;
    code?: string;
    message?: string;
  };
  if (e?.authenticationFailed) {
    const detail = e.responseText || e.serverResponseCode || 'invalid credentials';
    return `Authentication failed: check the email address and app password (${detail})`;
  }
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') {
    return `Could not resolve the IMAP host (${e.code}): check the IMAP Host field`;
  }
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET') {
    return `Could not reach the IMAP server (${e.code}): check the host and port`;
  }
  return e?.responseText || e?.serverResponseCode || e?.message || 'IMAP connection failed';
}

/** ImapFlow constructor options for a resolved credential set. */
export function buildImapClientOptions(creds: ResolvedCredentials) {
  return {
    host: creds.imap.host,
    port: creds.imap.port,
    secure: creds.imap.tls,
    auth: {
      user: creds.imap.user,
      pass: creds.imap.password,
    },
    // logger:false silences imapflow's pino-style chatter.
    logger: false as const,
    ...IMAP_TIMEOUTS,
  };
}

/** Project an imapflow fetch row into the adapter's envelope shape. */
export function toEnvelopeForAdapter(raw: ImapFetchMessage): ImapMessageEnvelope {
  const envelope = raw.envelope ?? {};
  const firstFrom = envelope.from?.[0];
  const text = raw.source ? raw.source.toString('utf8') : undefined;
  return {
    uid: raw.uid,
    messageId: envelope.messageId,
    inReplyTo: envelope.inReplyTo,
    subject: envelope.subject,
    date: envelope.date,
    from: firstFrom ? { address: firstFrom.address, name: firstFrom.name } : undefined,
    to: envelope.to?.map((t) => ({ address: t.address, name: t.name })),
    text,
  };
}
