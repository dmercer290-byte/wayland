// tests/integration/process/acp/session/AcpSession.prompt.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcpSession } from '@process/acp/session/AcpSession';
import type { AcpClient, ClientFactory } from '@process/acp/infra/IAcpClient';
import type { AgentConfig, SessionCallbacks, SessionStatus } from '@process/acp/types';
import type { SessionOptions } from '@process/acp/session/AcpSession';

function createMockCallbacks(): SessionCallbacks {
  return {
    onMessage: vi.fn(),
    onSessionId: vi.fn(),
    onStatusChange: vi.fn(),
    onConfigUpdate: vi.fn(),
    onModelUpdate: vi.fn(),
    onModeUpdate: vi.fn(),
    onContextUsage: vi.fn(),
    onPermissionRequest: vi.fn(),
    onSignal: vi.fn(),
  };
}

function createMockClient(): AcpClient {
  return {
    start: vi.fn().mockResolvedValue({ protocolVersion: '0.1', capabilities: {} }),
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      currentModelId: 'claude-3',
      availableModels: [],
      currentModeId: 'code',
      availableModes: [],
      configOptions: [],
    }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    cancel: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setConfigOption: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({}),
    authenticate: vi.fn().mockResolvedValue({}),
    lifecycleSnapshot: { pid: null, running: false, lastExit: null },
    onDisconnect: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

const baseConfig: AgentConfig = {
  agentBackend: 'test',
  agentSource: 'builtin',
  agentId: 'builtin:test',
  cwd: '/tmp',
  command: '/usr/bin/test-agent',
  args: ['--stdio'],
};

describe('AcpSession prompt flow', () => {
  let callbacks: SessionCallbacks;
  let client: AcpClient;
  let clientFactory: ClientFactory;

  beforeEach(() => {
    callbacks = createMockCallbacks();
    client = createMockClient();
    clientFactory = { create: vi.fn(() => client) };
  });

  async function startSession() {
    const session = new AcpSession(baseConfig, clientFactory, callbacks);
    session.start();
    await vi.waitFor(() => expect(session.status).toBe('active'));
    return session;
  }

  it('sendMessage triggers prompt directly (INV-S-02)', async () => {
    const session = await startSession();
    session.sendMessage('hello');
    await vi.waitFor(() => expect(client.prompt).toHaveBeenCalledOnce());
    expect(session.status).toBe('active');
  });

  it('sendMessage throws in idle state', async () => {
    const session = new AcpSession(baseConfig, clientFactory, callbacks);
    await expect(session.sendMessage('hello')).rejects.toThrow(/Cannot send in idle state/);
  });

  it('sendMessage from suspended triggers resume (T16)', async () => {
    const session = await startSession();
    await session.suspend();
    expect(session.status).toBe('suspended');
    session.sendMessage('after suspend');
    await vi.waitFor(() => expect(['resuming', 'active', 'prompting'].includes(session.status)).toBe(true));
  });

  it('sendMessage during prompting queues the follow-up and flushes it after the turn', async () => {
    const session = await startSession();

    // Hold the first turn open so the session stays in 'prompting'.
    let releaseFirstTurn: (value: { stopReason: string }) => void = () => {};
    (client.prompt as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirstTurn = resolve;
        })
    );

    session.sendMessage('first');
    await vi.waitFor(() => expect(session.status).toBe('prompting'));

    // A second message arriving mid-turn must NOT throw "Cannot send in prompting state".
    await expect(session.sendMessage('second')).resolves.toBeUndefined();
    expect(client.prompt).toHaveBeenCalledTimes(1); // queued, not sent yet

    // Finishing the first turn flushes the queued follow-up automatically.
    releaseFirstTurn({ stopReason: 'end_turn' });
    await vi.waitFor(() => expect(client.prompt).toHaveBeenCalledTimes(2));
  });
});
