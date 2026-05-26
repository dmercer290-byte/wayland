/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

/**
 * Wave 5 Task 5.1g — DOM tests for CrossProjectTab.
 *
 * Covers:
 *   - Scope bar reflects the active brain (project vs app) returned by
 *     `useActiveBrainScope`.
 *   - Switch ON forces scope='app' in the verb args regardless of the
 *     active brain.
 *   - Submitting a query triggers `cross_project_search` with the effective
 *     scope + query.
 *   - Match rows render the project basename, preview text, and score.
 *   - Clicking a match shows the Wave 6 navigation-stub Message.info toast.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrainScope } from '@renderer/pages/memory/getActiveBrainScope';

type InvokeArgs = { verb: string; args?: Record<string, unknown> };
type InvokeResult = { ok: true; data?: unknown } | { ok: false; error?: string; errorReason?: string };

const { brainInvokeMock, useActiveBrainScopeMock, messageInfoSpy } = vi.hoisted(() => ({
  brainInvokeMock: vi.fn<(args: InvokeArgs) => Promise<InvokeResult>>(),
  useActiveBrainScopeMock: vi.fn<() => BrainScope>(),
  messageInfoSpy: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    ijfw: {
      brainInvoke: { invoke: brainInvokeMock },
    },
  },
}));

vi.mock('@renderer/pages/memory/getActiveBrainScope', () => ({
  useActiveBrainScope: () => useActiveBrainScopeMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Echo interpolated values so the scope_label_project test can assert
      // the project name shows up in the rendered output.
      if (opts && typeof opts === 'object' && 'project' in opts) {
        return `${key}:${String((opts as { project: unknown }).project)}`;
      }
      if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
        const dv = (opts as { defaultValue?: string }).defaultValue;
        if (dv !== undefined && key === 'memory.error.gibberish') return dv;
      }
      return key;
    },
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      ...actual.Message,
      info: messageInfoSpy,
    },
  };
});

import CrossProjectTab from '@renderer/pages/memory/tabs/CrossProjectTab';

const defaultMatches = [
  {
    projectPath: '/Users/sean/dev/wayland',
    entryId: 'm1',
    preview: 'Stripe webhooks are idempotent',
    score: 0.87,
  },
  {
    projectPath: '/Users/sean/dev/launchpad',
    entryId: 'm2',
    preview: 'Aevent webinar replays expire in 7 days',
    score: 0.64,
  },
];

const setupDefaultSearchOk = (): void => {
  brainInvokeMock.mockImplementation(async ({ verb }) => {
    if (verb === 'cross_project_search') {
      return { ok: true, data: { matches: defaultMatches } };
    }
    return { ok: false, errorReason: 'unknown' };
  });
};

beforeEach(() => {
  brainInvokeMock.mockReset();
  useActiveBrainScopeMock.mockReset();
  messageInfoSpy.mockReset();
  useActiveBrainScopeMock.mockReturnValue({ scope: 'project', path: '/Users/sean/dev/wayland' });
  // Default: empty matches so the hook always has a resolvable promise even
  // when an individual test does not opt into a richer payload.
  brainInvokeMock.mockResolvedValue({ ok: true, data: { matches: [] } });
});

afterEach(() => {
  cleanup();
});

describe('CrossProjectTab', () => {
  it('renders the project-scope label with the basename when active brain is a project', () => {
    useActiveBrainScopeMock.mockReturnValue({
      scope: 'project',
      path: '/Users/sean/dev/wayland',
    });
    render(<CrossProjectTab />);
    const bar = screen.getByTestId('memory-cross-scope-bar');
    expect(bar.textContent).toContain('memory.crossProject.scope_label_project:wayland');
  });

  it('renders the app-scope label when active brain is app', () => {
    useActiveBrainScopeMock.mockReturnValue({ scope: 'app', path: '/' });
    render(<CrossProjectTab />);
    const bar = screen.getByTestId('memory-cross-scope-bar');
    expect(bar.textContent).toContain('memory.crossProject.scope_label_app');
  });

  it('does not invoke cross_project_search until the user submits a query', async () => {
    setupDefaultSearchOk();
    render(<CrossProjectTab />);
    // Submitting empty input still calls the verb once with an empty query —
    // it's the keystroke phase that should NOT trigger calls. Verify no call
    // before any interaction.
    expect(
      brainInvokeMock.mock.calls.some((c) => c[0]?.verb === 'cross_project_search' && c[0]?.args?.query !== '')
    ).toBe(false);
  });

  it('submitting a query invokes cross_project_search with the active project scope', async () => {
    setupDefaultSearchOk();
    useActiveBrainScopeMock.mockReturnValue({
      scope: 'project',
      path: '/Users/sean/dev/wayland',
    });
    render(<CrossProjectTab />);
    const input = screen.getByPlaceholderText('memory.crossProject.search_placeholder') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'webhooks' } });
    });
    const searchBtn = document.querySelector('.arco-input-search-btn') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(searchBtn);
    });
    await waitFor(() => {
      const call = brainInvokeMock.mock.calls.find((c) => c[0]?.args?.query === 'webhooks');
      expect(call).toBeTruthy();
      expect(call?.[0]).toEqual({
        verb: 'cross_project_search',
        args: { query: 'webhooks', scope: 'project', path: '/Users/sean/dev/wayland' },
      });
    });
  });

  it('Switch ON forces scope=app in the cross_project_search args even when active brain is project', async () => {
    setupDefaultSearchOk();
    useActiveBrainScopeMock.mockReturnValue({
      scope: 'project',
      path: '/Users/sean/dev/wayland',
    });
    render(<CrossProjectTab />);

    // Toggle the switch on — Arco Switch renders as role="switch".
    const toggle = screen.getByRole('switch') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(toggle);
    });

    const input = screen.getByPlaceholderText('memory.crossProject.search_placeholder') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'replays' } });
    });
    const searchBtn = document.querySelector('.arco-input-search-btn') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(searchBtn);
    });

    await waitFor(() => {
      const call = brainInvokeMock.mock.calls.find((c) => c[0]?.args?.query === 'replays');
      expect(call?.[0].args).toEqual({ query: 'replays', scope: 'app', path: '/' });
    });
  });

  it('renders each match with the project basename, preview, and score', async () => {
    setupDefaultSearchOk();
    render(<CrossProjectTab />);
    const input = screen.getByPlaceholderText('memory.crossProject.search_placeholder') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'anything' } });
    });
    const searchBtn = document.querySelector('.arco-input-search-btn') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(searchBtn);
    });

    const row1 = await screen.findByTestId('memory-cross-match-m1');
    expect(row1.textContent).toContain('wayland');
    expect(row1.textContent).toContain('Stripe webhooks are idempotent');
    expect(row1.textContent).toContain('0.87');

    const row2 = await screen.findByTestId('memory-cross-match-m2');
    expect(row2.textContent).toContain('launchpad');
    expect(row2.textContent).toContain('0.64');
  });

  it('clicking a match row shows the Wave 6 navigation-stub Message.info', async () => {
    setupDefaultSearchOk();
    render(<CrossProjectTab />);
    const input = screen.getByPlaceholderText('memory.crossProject.search_placeholder') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'anything' } });
    });
    const searchBtn = document.querySelector('.arco-input-search-btn') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(searchBtn);
    });

    const row = await screen.findByTestId('memory-cross-match-m1');
    await act(async () => {
      fireEvent.click(row);
    });

    expect(messageInfoSpy).toHaveBeenCalledWith('memory.crossProject.navigation_stub');
  });
});
