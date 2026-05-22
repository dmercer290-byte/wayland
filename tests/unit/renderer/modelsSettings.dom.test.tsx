/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

/**
 * Models settings page (Packet 2A) — behavior contract.
 *
 * Covers the spec §4.2 / §4.3 surface:
 *  - connected rows render from `modelRegistry.list()`
 *  - a rejected-key connect surfaces the inline error in the connect panel
 *  - the empty state shows when there are no providers and no detected keys
 *  - the detected-keys strip shows Use / Ignore when `detectKeys()` returns keys
 *  - a provider in `state: 'error'` renders the "Action needed — Fix" row
 *
 * `ipcBridge` is mocked; the file name uses the `.dom.test.tsx` suffix so it
 * runs in the jsdom Vitest project (the `node` project only matches `.test.ts`).
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IModelRegistryDetectedKey, IModelRegistryProviderView } from '../../../src/common/adapter/ipcBridge';

// ---------------------------------------------------------------------------
// Mocks — i18n returns the default value (or the key) so assertions read clean.
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Echo interpolation so error/count assertions can match on substrings.
      if (opts && typeof opts === 'object') {
        let out = key;
        for (const [k, v] of Object.entries(opts)) {
          if (k === 'defaultValue') continue;
          out += `:${k}=${String(v)}`;
        }
        return out;
      }
      return key;
    },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => React.createElement('span', null, i18nKey),
}));

// modelRegistry IPC surface (consumed by useModelRegistry + ConnectPanel).
const mockList = vi.fn();
const mockDetectKeys = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockGoogleLogin = vi.fn();

vi.mock('../../../src/common/adapter/ipcBridge', () => ({
  modelRegistry: {
    list: { invoke: (...a: unknown[]) => mockList(...a) },
    detectKeys: { invoke: (...a: unknown[]) => mockDetectKeys(...a) },
    connect: { invoke: (...a: unknown[]) => mockConnect(...a) },
    disconnect: { invoke: (...a: unknown[]) => mockDisconnect(...a) },
    testConnection: { invoke: vi.fn() },
    getCatalog: { invoke: vi.fn() },
    toggleModel: { invoke: vi.fn() },
    refresh: { invoke: vi.fn() },
    rekey: { invoke: vi.fn() },
    curatedForAgent: { invoke: vi.fn() },
  },
}));

// `@/common` barrel — GoogleButton imports `ipcBridge` from here.
vi.mock('../../../src/common', () => ({
  ipcBridge: {
    googleAuth: {
      login: { invoke: (...a: unknown[]) => mockGoogleLogin(...a) },
    },
  },
}));

// SettingsPageShell is page chrome (breadcrumb, mobile nav, router hooks) —
// stub it to a plain wrapper so the test focuses on the Models page itself.
vi.mock('../../../src/renderer/pages/settings/components/SettingsPageShell', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'settings-shell' }, children),
}));

// Import after the mocks are registered.
import ModelsSettings from '../../../src/renderer/pages/settings/ModelsSettings';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const connectedProvider: IModelRegistryProviderView = {
  providerId: 'anthropic',
  connectedVia: 'API key',
  state: 'connected',
  modelCount: 12,
};

const erroredProvider: IModelRegistryProviderView = {
  providerId: 'openai',
  connectedVia: 'API key',
  state: 'error',
  modelCount: 0,
  error: 'unauthorized',
};

const detectedKey: IModelRegistryDetectedKey = {
  providerId: 'groq',
  source: 'env:GROQ_API_KEY',
};

beforeEach(() => {
  mockList.mockReset().mockResolvedValue([]);
  mockDetectKeys.mockReset().mockResolvedValue([]);
  mockConnect.mockReset().mockResolvedValue({ ok: true });
  mockDisconnect.mockReset().mockResolvedValue({ ok: true });
  mockGoogleLogin.mockReset().mockResolvedValue({ success: true, data: { account: '' } });
});

afterEach(() => {
  vi.clearAllMocks();
});

const renderPage = () => render(<ModelsSettings />);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelsSettings page', () => {
  it('renders a connected row from modelRegistry.list()', async () => {
    mockList.mockResolvedValue([connectedProvider]);

    renderPage();

    expect(await screen.findByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('settings.modelsPage.row.connected')).toBeInTheDocument();
    // Model count interpolates the count.
    expect(screen.getByText(/row\.modelCount:count=12/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no providers and no detected keys', async () => {
    mockList.mockResolvedValue([]);
    mockDetectKeys.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('settings.modelsPage.empty.note')).toBeInTheDocument();
  });

  it('shows the detected-keys strip with Use / Ignore when detectKeys() returns keys', async () => {
    mockList.mockResolvedValue([]);
    mockDetectKeys.mockResolvedValue([detectedKey]);

    renderPage();

    // The strip text interpolates the recognized provider name.
    expect(await screen.findByText(/detected\.found:provider=Groq/)).toBeInTheDocument();
    expect(screen.getByText('settings.modelsPage.detected.use')).toBeInTheDocument();
    expect(screen.getByText('settings.modelsPage.detected.ignore')).toBeInTheDocument();
  });

  it('renders the "Action needed — Fix" row for a provider in the error state', async () => {
    mockList.mockResolvedValue([erroredProvider]);

    renderPage();

    expect(await screen.findByText('OpenAI')).toBeInTheDocument();
    // Persistent error status, not a stale green badge.
    expect(screen.getByRole('alert')).toHaveTextContent('row.actionNeeded');
    expect(screen.getByText('settings.modelsPage.row.fix')).toBeInTheDocument();
    // The green "Connected" status must NOT be present for an errored provider.
    expect(screen.queryByText('settings.modelsPage.row.connected')).not.toBeInTheDocument();
  });

  it('shows the inline connect error when a pasted key is rejected', async () => {
    mockList.mockResolvedValue([]);
    mockDetectKeys.mockResolvedValue([]);
    // The backend test call rejects the key as unauthorized.
    mockConnect.mockResolvedValue({ ok: false, error: 'unauthorized' });

    renderPage();

    // Wait for the connect panel to mount.
    const input = await screen.findByPlaceholderText('settings.modelsPage.connect.keyPlaceholder');
    // A recognized Anthropic key format.
    fireEvent.change(input, { target: { value: 'sk-ant-test-key-value' } });

    const connectBtn = screen.getByText('settings.modelsPage.connect.connect');
    fireEvent.click(connectBtn);

    await waitFor(() => {
      // The inline error renders with the unauthorized reason + provider name.
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((el) => el.textContent?.includes('connect.errorUnauthorized'))).toBe(true);
    });
    expect(mockConnect).toHaveBeenCalledWith({
      providerId: 'anthropic',
      creds: { key: 'sk-ant-test-key-value' },
    });
  });

  it('shows the unrecognized-format error and does not call connect for an unknown key', async () => {
    mockList.mockResolvedValue([]);
    mockDetectKeys.mockResolvedValue([]);

    renderPage();

    const input = await screen.findByPlaceholderText('settings.modelsPage.connect.keyPlaceholder');
    fireEvent.change(input, { target: { value: 'totally-unrecognized-key' } });
    fireEvent.click(screen.getByText('settings.modelsPage.connect.connect'));

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((el) => el.textContent?.includes('connect.errorUnrecognized'))).toBe(true);
    });
    // An unrecognized key never reaches the backend.
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
