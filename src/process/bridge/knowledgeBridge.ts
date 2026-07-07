/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge Base IPC bridge - wires the custom wiki + memory (~/.genesis)
 * to the renderer. All args validated; errors return { ok: false, error } -
 * never throw across IPC.
 */

import log from 'electron-log';
import { z } from 'zod';
import { ipcBridge } from '@/common';
import { MEMORY_KINDS } from '@process/services/knowledge/knowledgeFormat';
import { getKnowledgeService } from '@process/services/knowledge/knowledgeService';

const slugSchema = z.object({ slug: z.string().min(1) });
const writePageSchema = z.object({ title: z.string().min(1), content: z.string(), slug: z.string().optional() });
const searchSchema = z.object({ query: z.string() });
const addMemorySchema = z.object({
  kind: z.enum(MEMORY_KINDS),
  text: z.string().min(1),
  tags: z.array(z.string()).optional(),
});
const listMemorySchema = z.object({
  query: z.string().optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  tag: z.string().optional(),
  limit: z.number().int().positive().max(1000).optional(),
});
const idSchema = z.object({ id: z.string().min(1) });

export function initKnowledgeBridge(): void {
  const service = getKnowledgeService();

  ipcBridge.knowledge.listPages.provider(async () => {
    try {
      return await service.listPages();
    } catch (err) {
      log.error('[knowledge] listPages failed', { err });
      return [];
    }
  });

  ipcBridge.knowledge.readPage.provider(async (args: unknown) => {
    const parsed = slugSchema.safeParse(args);
    if (!parsed.success) return undefined;
    try {
      return await service.readPage(parsed.data.slug);
    } catch (err) {
      log.error('[knowledge] readPage failed', { err });
      return undefined;
    }
  });

  ipcBridge.knowledge.writePage.provider(async (args: unknown) => {
    const parsed = writePageSchema.safeParse(args);
    if (!parsed.success || !parsed.data.title) return { ok: false as const, error: 'invalid_args' };
    try {
      return await service.writePage({
        title: parsed.data.title,
        content: parsed.data.content ?? '',
        slug: parsed.data.slug,
      });
    } catch (err) {
      log.error('[knowledge] writePage failed', { err });
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.knowledge.deletePage.provider(async (args: unknown) => {
    const parsed = slugSchema.safeParse(args);
    if (!parsed.success) return { ok: false };
    return service.deletePage(parsed.data.slug);
  });

  ipcBridge.knowledge.searchWiki.provider(async (args: unknown) => {
    const parsed = searchSchema.safeParse(args);
    if (!parsed.success) return [];
    try {
      return await service.searchWiki(parsed.data.query);
    } catch (err) {
      log.error('[knowledge] searchWiki failed', { err });
      return [];
    }
  });

  ipcBridge.knowledge.addMemory.provider(async (args: unknown) => {
    const parsed = addMemorySchema.safeParse(args);
    if (!parsed.success || !parsed.data.text || !parsed.data.kind) {
      return { ok: false as const, error: 'invalid_args' };
    }
    try {
      return await service.addMemory({
        kind: parsed.data.kind,
        text: parsed.data.text,
        tags: parsed.data.tags,
        source: 'manual',
      });
    } catch (err) {
      log.error('[knowledge] addMemory failed', { err });
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.knowledge.listMemory.provider(async (args: unknown) => {
    const parsed = listMemorySchema.safeParse(args ?? {});
    if (!parsed.success) return [];
    try {
      return await service.listMemory(parsed.data);
    } catch (err) {
      log.error('[knowledge] listMemory failed', { err });
      return [];
    }
  });

  ipcBridge.knowledge.deleteMemory.provider(async (args: unknown) => {
    const parsed = idSchema.safeParse(args);
    if (!parsed.success) return { ok: false };
    return service.deleteMemory(parsed.data.id);
  });
}
