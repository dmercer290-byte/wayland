/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const suggestMock = vi.fn();
const telemetryMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/common', () => ({
  ipcBridge: {
    kickoff: {
      suggest: { invoke: (...a: unknown[]) => suggestMock(...a) },
      telemetry: { invoke: (...a: unknown[]) => telemetryMock(...a) },
    },
  },
}));

import { useKickoff, __resetKickoffSessionDismissForTests } from '@/renderer/hooks/kickoff/useKickoff';

const makeSuggestion = (overrides?: Partial<Parameters<typeof Object.assign>[0]>) => ({
  cascadeLevel: 3,
  cascadeReason: 'cold-start-library',
  kickoffId: 'morning-cold',
  text: 'Want me to surface the decision?',
  prefill: 'Surface the decision.',
  alternates: [
    { kickoffId: 'alt-1', text: 'Want me to prep 1:1 agendas?', prefill: 'Prep 1:1 agendas.' },
    { kickoffId: 'alt-2', text: 'Want me to retro the week?', prefill: 'Retro the week.' },
  ],
  ...(overrides ?? {}),
});

beforeEach(() => {
  suggestMock.mockReset();
  telemetryMock.mockClear();
  __resetKickoffSessionDismissForTests();
});

describe('useKickoff', () => {
  it('fetches a suggestion on mount + exposes it as visible', async () => {
    suggestMock.mockResolvedValue(makeSuggestion());
    const { result } = renderHook(() => useKickoff('helm'));
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current.currentText).toMatch(/surface the decision/i);
    expect(suggestMock).toHaveBeenCalledWith({ assistantId: 'helm' });
  });

  it('handles notRendered by hiding the card and firing telemetry', async () => {
    suggestMock.mockResolvedValue({ notRendered: 'no-kickoffs-defined' });
    const { result } = renderHook(() => useKickoff('helm'));
    await waitFor(() => expect(telemetryMock).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
    expect(telemetryMock).toHaveBeenCalledWith(expect.objectContaining({ event: 'not_rendered' }));
  });

  it('accept() returns the prefill, fires accepted telemetry, and dismisses', async () => {
    suggestMock.mockResolvedValue(makeSuggestion());
    const { result } = renderHook(() => useKickoff('helm'));
    await waitFor(() => expect(result.current.visible).toBe(true));
    let prefill: string | undefined;
    act(() => {
      prefill = result.current.accept();
    });
    expect(prefill).toBe('Surface the decision.');
    expect(telemetryMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'accepted', kickoffId: 'morning-cold' })
    );
    expect(result.current.visible).toBe(false);
  });

  it('redirect() rotates through alternates then exhausts to dismiss', async () => {
    suggestMock.mockResolvedValue(makeSuggestion());
    const { result } = renderHook(() => useKickoff('helm'));
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => {
      result.current.redirect();
    });
    expect(result.current.currentText).toMatch(/prep 1:1 agendas/i);
    act(() => {
      result.current.redirect();
    });
    expect(result.current.currentText).toMatch(/retro the week/i);
    act(() => {
      // Third redirect with 2 alternates → ladder exhausted, dismiss.
      result.current.redirect();
    });
    expect(result.current.visible).toBe(false);
  });

  it('accept after redirect uses the rotated alternate prefill', async () => {
    suggestMock.mockResolvedValue(makeSuggestion());
    const { result } = renderHook(() => useKickoff('helm'));
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => {
      result.current.redirect();
    });
    let prefill: string | undefined;
    act(() => {
      prefill = result.current.accept();
    });
    expect(prefill).toBe('Prep 1:1 agendas.');
    expect(telemetryMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'accepted', kickoffId: 'alt-1' })
    );
  });

  it('dismissByInteraction fires dismissed telemetry and hides the card', async () => {
    suggestMock.mockResolvedValue(makeSuggestion());
    const { result } = renderHook(() => useKickoff('helm'));
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => {
      result.current.dismissByInteraction();
    });
    expect(result.current.visible).toBe(false);
    expect(telemetryMock).toHaveBeenCalledWith(expect.objectContaining({ event: 'dismissed' }));
  });

  it('per-session dismiss persists across remount for the same assistantId', async () => {
    suggestMock.mockResolvedValue(makeSuggestion());
    const first = renderHook(() => useKickoff('helm'));
    await waitFor(() => expect(first.result.current.visible).toBe(true));
    act(() => {
      first.result.current.dismissByInteraction();
    });
    first.unmount();
    suggestMock.mockClear();
    const second = renderHook(() => useKickoff('helm'));
    // Should NOT re-fetch and should NOT become visible.
    await waitFor(() => expect(second.result.current.visible).toBe(false));
    expect(suggestMock).not.toHaveBeenCalled();
  });

  it('switching assistantId triggers a fresh fetch + new suggestion', async () => {
    suggestMock
      .mockResolvedValueOnce(makeSuggestion({ kickoffId: 'helm-a', text: 'helm card' }))
      .mockResolvedValueOnce(makeSuggestion({ kickoffId: 'sales-a', text: 'sales card' }));
    const { result, rerender } = renderHook(({ id }: { id: string }) => useKickoff(id), {
      initialProps: { id: 'helm' },
    });
    await waitFor(() => expect(result.current.currentText).toBe('helm card'));
    rerender({ id: 'sales' });
    await waitFor(() => expect(result.current.currentText).toBe('sales card'));
    expect(suggestMock).toHaveBeenCalledWith({ assistantId: 'helm' });
    expect(suggestMock).toHaveBeenCalledWith({ assistantId: 'sales' });
  });

  it('undefined assistantId yields invisible state with no IPC call', async () => {
    const { result } = renderHook(() => useKickoff(undefined));
    expect(result.current.visible).toBe(false);
    expect(suggestMock).not.toHaveBeenCalled();
  });
});
