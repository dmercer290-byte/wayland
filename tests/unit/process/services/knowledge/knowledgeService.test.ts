/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBacklinks,
  extractWikiLinks,
  parseMemoryLine,
  slugify,
  snippetAround,
  tagsFromContent,
} from '@/process/services/knowledge/knowledgeFormat';
import { KnowledgeService } from '@/process/services/knowledge/knowledgeService';

describe('knowledgeFormat', () => {
  it('slugify normalizes titles safely', () => {
    expect(slugify('Home Lab Setup!')).toBe('home-lab-setup');
    expect(slugify('  ../../etc/passwd  ')).toBe('etc-passwd');
    expect(slugify('')).toBe('untitled');
  });

  it('extracts wikilinks including labeled ones, deduped', () => {
    const links = extractWikiLinks('See [[Home Lab]] and [[home lab]] plus [[GPU Box|the box]].');
    expect(links).toEqual(['home-lab', 'gpu-box']);
  });

  it('parses tags line and builds backlinks', () => {
    expect(tagsFromContent('# T\ntags: Infra, gpu\n')).toEqual(['infra', 'gpu']);
    const back = buildBacklinks([
      { slug: 'a', links: ['b'] },
      { slug: 'b', links: ['a', 'b'] },
    ]);
    expect(back.get('b')).toEqual(['a']);
    expect(back.get('a')).toEqual(['b']); // self-link on b ignored
  });

  it('snippetAround windows the match and malformed memory lines are skipped', () => {
    const snippet = snippetAround('x'.repeat(200) + 'NEEDLE' + 'y'.repeat(200), 'needle');
    expect(snippet).toContain('NEEDLE');
    expect(snippet.length).toBeLessThan(200);
    expect(parseMemoryLine('not json')).toBeUndefined();
    expect(parseMemoryLine('{"id":"x"}')).toBeUndefined();
  });
});

describe('KnowledgeService', () => {
  let root: string;
  let service: KnowledgeService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-test-'));
    service = new KnowledgeService(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes, lists, reads pages with links and backlinks', async () => {
    await service.writePage({ title: 'Home Lab', content: 'tags: infra\n\nMy servers. See [[GPU Box]].' });
    await service.writePage({ title: 'GPU Box', content: 'The 3090 machine.' });
    const pages = await service.listPages();
    expect(pages.map((p) => p.slug).sort()).toEqual(['gpu-box', 'home-lab']);

    const gpu = await service.readPage('gpu-box');
    expect(gpu?.backlinks).toEqual(['home-lab']);
    const home = await service.readPage('Home Lab'); // title works as slug input
    expect(home?.links).toEqual(['gpu-box']);
    expect(home?.tags).toEqual(['infra']);
    expect(home?.content.startsWith('# Home Lab')).toBe(true); // heading injected
  });

  it('searches wiki content and titles', async () => {
    await service.writePage({ title: 'Ollama Notes', content: 'keep_alive zero unloads VRAM' });
    const hits = await service.searchWiki('vram');
    expect(hits).toHaveLength(1);
    expect(hits[0].slug).toBe('ollama-notes');
    expect(hits[0].snippet.toLowerCase()).toContain('vram');
    expect(await service.searchWiki('nomatch')).toEqual([]);
  });

  it('deletes pages and rejects empty titles', async () => {
    await service.writePage({ title: 'Temp', content: 'x' });
    expect((await service.deletePage('temp')).ok).toBe(true);
    expect(await service.readPage('temp')).toBeUndefined();
    expect(await service.writePage({ title: '  ', content: 'x' })).toEqual({ ok: false, error: 'empty_title' });
  });

  it('adds, filters, and deletes memory entries', async () => {
    await service.addMemory({ kind: 'preference', text: 'Always use bun, not npm', tags: ['Tooling'] });
    await service.addMemory({ kind: 'fact', text: 'GPU box has a 3090', tags: ['infra'] });

    const all = await service.listMemory();
    expect(all).toHaveLength(2);
    expect(all[0].text).toContain('3090'); // newest first

    expect(await service.listMemory({ kind: 'preference' })).toHaveLength(1);
    expect(await service.listMemory({ query: 'bun' })).toHaveLength(1);
    expect(await service.listMemory({ tag: 'tooling' })).toHaveLength(1); // tags lowercased

    const target = all[1];
    expect((await service.deleteMemory(target.id)).ok).toBe(true);
    expect(await service.listMemory()).toHaveLength(1);
    expect((await service.deleteMemory('nonexistent')).ok).toBe(false);
  });

  it('survives a corrupted memory file line', async () => {
    await service.addMemory({ kind: 'note', text: 'good entry' });
    await fs.appendFile(path.join(root, 'memory.jsonl'), 'garbage line\n');
    await service.addMemory({ kind: 'note', text: 'another good one' });
    expect(await service.listMemory()).toHaveLength(2);
  });
});
