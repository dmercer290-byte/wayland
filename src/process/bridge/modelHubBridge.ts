/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model Hub IPC bridge - wires the multi-server model dashboard (list /
 * add / remove servers, VRAM swap) to the renderer. All args validated;
 * errors return { ok: false, error } - never throw across IPC.
 */

import log from 'electron-log';
import { z } from 'zod';
import { ipcBridge } from '@/common';
import { addServer, listAllModels, loadModel, removeServer } from '@process/services/modelHub/modelHubService';

const addServerSchema = z.object({ url: z.string().min(1), name: z.string().optional() });
const removeServerSchema = z.object({ id: z.string().min(1) });
const loadModelSchema = z.object({ serverId: z.string().min(1), model: z.string().min(1) });

export function initModelHubBridge(): void {
  ipcBridge.modelHub.list.provider(async () => {
    try {
      return await listAllModels();
    } catch (err) {
      log.error('[model-hub] list failed', { err });
      return { servers: [], models: [] };
    }
  });

  ipcBridge.modelHub.addServer.provider(async (args: unknown) => {
    const parsed = addServerSchema.safeParse(args);
    if (!parsed.success || !parsed.data.url) return { ok: false as const, error: 'invalid_args' };
    try {
      return await addServer({ url: parsed.data.url, name: parsed.data.name });
    } catch (err) {
      log.error('[model-hub] addServer failed', { err });
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.modelHub.removeServer.provider(async (args: unknown) => {
    const parsed = removeServerSchema.safeParse(args);
    if (parsed.success) {
      await removeServer(parsed.data.id);
    }
    return { ok: true as const };
  });

  ipcBridge.modelHub.loadModel.provider(async (args: unknown) => {
    const parsed = loadModelSchema.safeParse(args);
    if (!parsed.success) return { ok: false as const, error: 'invalid_args' };
    try {
      const result = await loadModel(parsed.data.serverId, parsed.data.model);
      if (result.ok) {
        log.info('[model-hub] loaded model', { model: result.loaded, unloaded: result.unloaded });
      }
      return result;
    } catch (err) {
      log.error('[model-hub] loadModel failed', { err });
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
