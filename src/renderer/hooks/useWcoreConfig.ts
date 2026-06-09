/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { ipcBridge } from '@/common';

/**
 * Renderer wrapper around the human-only `ipcBridge.wcoreConfig` surface (the
 * engine `config.toml` sections) and `ipcBridge.wcoreProfiles` (profile
 * directories).
 *
 * SECURITY (SEC-6): `setSection` is remote-denied and HUMAN-ONLY - the engine
 * reads this config live, so it must only ever be driven by direct human intent
 * in the trusted renderer, never by the agent. The env-passthrough sensitive-
 * name rejection is enforced on BOTH sides; the renderer rejects sensitive
 * names in the input and the main-process bridge filters again before writing.
 */
export type UseWcoreConfig = {
  /** Read one top-level `config.toml` section (undefined when absent). */
  getSection: <T = Record<string, unknown>>(section: string) => Promise<T | undefined>;
  /** Replace one top-level section wholesale (preserves other sections). */
  setSection: (section: string, value: Record<string, unknown>) => Promise<boolean>;
};

export function useWcoreConfig(): UseWcoreConfig {
  const getSection = useCallback(async <T = Record<string, unknown>>(section: string): Promise<T | undefined> => {
    const result = await ipcBridge.wcoreConfig.getSection.invoke({ section });
    return result as T | undefined;
  }, []);

  const setSection = useCallback(async (section: string, value: Record<string, unknown>): Promise<boolean> => {
    const result = await ipcBridge.wcoreConfig.setSection.invoke({ section, value });
    return result.ok;
  }, []);

  return { getSection, setSection };
}
