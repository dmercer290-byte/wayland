/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import dns from 'node:dns';

// Prefer IPv4 in the main process. Several providers (e.g. Gmail) have an IPv6
// path that is far slower from some networks; combined with a busy main-process
// event loop (channel pollers, agent subprocesses) the slow IPv6 connect can
// trip socket timeouts - most visibly the IMAP email channel hanging on connect.
// Node defaults to 'verbatim' (often IPv6-first on dual-stack); 'ipv4first' keeps
// outbound TCP connects fast and reliable. Imported for its side effect, early,
// so it applies before any channel/agent opens a socket.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Older runtimes without setDefaultResultOrder - safe to ignore.
}
