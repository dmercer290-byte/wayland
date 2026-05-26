/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import log from 'electron-log';
import { hubInstaller } from '@process/extensions/hub/HubInstaller';
import { hubStateManager } from '@process/extensions/hub/HubStateManager';

/**
 * ijfwAutoInstallService
 *
 * Triggers a silent first-boot install of the IJFW Hub Extension so that
 * all 15 AI coding CLIs are unified with persistent memory on the user's
 * first Wayland launch. Subsequent boots are no-ops (state === 'installed').
 *
 * Opt-out: set IJFW_AUTO_INSTALL=never in the environment.
 * Non-fatal: install failure is logged as a warning; Wayland continues to
 * work normally and the Hub UI will surface the retry option.
 */
export const ijfwAutoInstallService = {
  /**
   * Fire-and-forget bootstrap. Call inside app.whenReady() without await.
   * Returns a Promise for testability but callers must NOT block on it.
   */
  async bootstrap(): Promise<void> {
    if (process.env.IJFW_AUTO_INSTALL === 'never') {
      log.info('[ijfw] auto-install opted out via IJFW_AUTO_INSTALL=never');
      return;
    }

    const state = hubStateManager.getTransientState('ijfw');
    if (state === 'installed' || state === 'installing') {
      log.info(`[ijfw] auto-install skipped — current state: ${state}`);
      return;
    }

    try {
      log.info('[ijfw] starting auto-install of IJFW Hub Extension');
      await hubInstaller.install('ijfw');
      log.info('[ijfw] auto-install complete — 15 AI coding CLIs unified');
    } catch (err) {
      log.warn('[ijfw] auto-install failed; will retry next boot', { err });
      // hubStateManager already records install_failed — retry UI surfaces it.
      // Non-fatal: Wayland continues to work without IJFW.
    }
  },
};
