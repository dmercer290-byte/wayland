/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../../../src/renderer/utils/ui/clipboard';

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

function stubSecureContext(secure: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
}

/** jsdom does not implement execCommand; define a stub we can assert against. */
function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockReturnValue(result);
  Object.defineProperty(document, 'execCommand', { value: fn, configurable: true, writable: true });
  return fn;
}

describe('copyText', () => {
  it('uses navigator.clipboard.writeText when available + secure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    stubSecureContext(true);

    await copyText('hello');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('FALLS BACK to execCommand when writeText rejects (issue #10)', async () => {
    // The Clipboard API is present but rejects (Electron/macOS permission/focus).
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    stubSecureContext(true);
    const exec = stubExecCommand(true);

    await expect(copyText('hello')).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('uses the execCommand fallback directly in a non-secure context', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    stubSecureContext(false);
    const exec = stubExecCommand(true);

    await copyText('hello');
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('rejects only when both paths fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    stubSecureContext(true);
    stubExecCommand(false);

    await expect(copyText('hello')).rejects.toThrow();
  });
});
