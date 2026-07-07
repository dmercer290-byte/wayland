/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge Base service - the custom, global memory + wiki. Storage is
 * deliberately boring: `~/.genesis/wiki/*.md` (one markdown file per page,
 * [[wikilinks]] between them) and `~/.genesis/memory.jsonl` (typed entries).
 * Files are the source of truth so the user, this app, and any other local
 * AI can read and edit the same knowledge with a text editor or git.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildBacklinks,
  extractWikiLinks,
  memoryMatches,
  pageMatches,
  parseMemoryLine,
  serializeMemoryEntry,
  slugify,
  snippetAround,
  tagsFromContent,
  titleFromContent,
} from './knowledgeFormat';
import type { MemoryEntry, MemoryKind, WikiPage, WikiPageMeta, WikiSearchHit } from './knowledgeFormat';

const MAX_PAGE_BYTES = 1_024 * 1_024; // a wiki page over 1 MB is a data file, not a note
const MAX_MEMORY_TEXT = 16_384;

export class KnowledgeService {
  readonly root: string;

  constructor(root?: string) {
    this.root = root ?? path.join(os.homedir(), '.genesis');
  }

  private get wikiDir(): string {
    return path.join(this.root, 'wiki');
  }

  private get memoryFile(): string {
    return path.join(this.root, 'memory.jsonl');
  }

  private pagePath(slug: string): string {
    // slugify output is [a-z0-9_-] only, so traversal is impossible; enforce anyway.
    const safe = slugify(slug);
    const resolved = path.resolve(this.wikiDir, `${safe}.md`);
    if (!resolved.startsWith(path.resolve(this.wikiDir) + path.sep)) {
      throw new Error(`invalid slug: ${slug}`);
    }
    return resolved;
  }

  // ---- wiki -------------------------------------------------------------

  async listPages(): Promise<WikiPageMeta[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.wikiDir);
    } catch {
      return [];
    }
    const metas: WikiPageMeta[] = [];
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const slug = name.slice(0, -3);
      try {
        const full = path.join(this.wikiDir, name);
        const [content, stat] = await Promise.all([fs.readFile(full, 'utf-8'), fs.stat(full)]);
        metas.push({
          slug,
          title: titleFromContent(content, slug),
          tags: tagsFromContent(content),
          updatedMs: stat.mtimeMs,
          links: extractWikiLinks(content),
        });
      } catch {
        // unreadable page never breaks the whole wiki
      }
    }
    metas.sort((a, b) => a.title.localeCompare(b.title));
    return metas;
  }

  async readPage(slug: string): Promise<WikiPage | undefined> {
    let content: string;
    let updatedMs: number;
    try {
      const full = this.pagePath(slug);
      [content, updatedMs] = await Promise.all([fs.readFile(full, 'utf-8'), fs.stat(full).then((s) => s.mtimeMs)]);
    } catch {
      return undefined;
    }
    const safe = slugify(slug);
    const metas = await this.listPages();
    const backlinks = buildBacklinks(metas).get(safe) ?? [];
    return {
      slug: safe,
      title: titleFromContent(content, safe),
      tags: tagsFromContent(content),
      updatedMs,
      links: extractWikiLinks(content),
      content,
      backlinks,
    };
  }

  /** Create or overwrite a page. Returns the slug actually written. */
  async writePage(input: {
    title: string;
    content: string;
    slug?: string;
  }): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
    const title = input.title.trim();
    if (!title) return { ok: false, error: 'empty_title' };
    if (Buffer.byteLength(input.content, 'utf-8') > MAX_PAGE_BYTES) return { ok: false, error: 'page_too_large' };
    const slug = slugify(input.slug ?? title);
    // Guarantee the page opens with its title so listings stay truthful.
    const content = /^#\s+/m.test(input.content) ? input.content : `# ${title}\n\n${input.content}`;
    await fs.mkdir(this.wikiDir, { recursive: true });
    const full = this.pagePath(slug);
    const tmp = `${full}.tmp-${crypto.randomUUID().slice(0, 8)}`;
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, full); // write-then-rename: a crash never corrupts a page
    return { ok: true, slug };
  }

  async deletePage(slug: string): Promise<{ ok: boolean }> {
    try {
      await fs.unlink(this.pagePath(slug));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  async searchWiki(query: string, limit = 20): Promise<WikiSearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    let names: string[];
    try {
      names = await fs.readdir(this.wikiDir);
    } catch {
      return [];
    }
    const hits: WikiSearchHit[] = [];
    for (const name of names) {
      if (!name.endsWith('.md') || hits.length >= limit) continue;
      const slug = name.slice(0, -3);
      try {
        const content = await fs.readFile(path.join(this.wikiDir, name), 'utf-8');
        const title = titleFromContent(content, slug);
        if (pageMatches(q, title, content)) {
          hits.push({ slug, title, snippet: snippetAround(content, q) });
        }
      } catch {
        // skip unreadable page
      }
    }
    return hits;
  }

  // ---- memory -----------------------------------------------------------

  async addMemory(input: {
    kind: MemoryKind;
    text: string;
    tags?: string[];
    source?: string;
  }): Promise<{ ok: true; entry: MemoryEntry } | { ok: false; error: string }> {
    const text = input.text.trim();
    if (!text) return { ok: false, error: 'empty_text' };
    if (text.length > MAX_MEMORY_TEXT) return { ok: false, error: 'text_too_large' };
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      kind: input.kind,
      text,
      tags: (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      source: input.source,
    };
    await fs.mkdir(this.root, { recursive: true });
    await fs.appendFile(this.memoryFile, serializeMemoryEntry(entry) + '\n', 'utf-8');
    return { ok: true, entry };
  }

  async listMemory(
    opts: { query?: string; kind?: MemoryKind; tag?: string; limit?: number } = {}
  ): Promise<MemoryEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.memoryFile, 'utf-8');
    } catch {
      return [];
    }
    const entries: MemoryEntry[] = [];
    for (const line of raw.split('\n')) {
      const entry = parseMemoryLine(line);
      if (entry && memoryMatches(entry, opts.query, opts.kind, opts.tag)) entries.push(entry);
    }
    entries.sort((a, b) => b.ts - a.ts);
    return entries.slice(0, opts.limit ?? 200);
  }

  async deleteMemory(id: string): Promise<{ ok: boolean }> {
    let raw: string;
    try {
      raw = await fs.readFile(this.memoryFile, 'utf-8');
    } catch {
      return { ok: false };
    }
    const kept = raw.split('\n').filter((line) => {
      const entry = parseMemoryLine(line);
      return entry !== undefined && entry.id !== id;
    });
    const removed = kept.length !== raw.split('\n').filter((l) => parseMemoryLine(l)).length;
    const tmp = `${this.memoryFile}.tmp-${crypto.randomUUID().slice(0, 8)}`;
    await fs.writeFile(tmp, kept.map((l) => l.trim()).join('\n') + (kept.length ? '\n' : ''), 'utf-8');
    await fs.rename(tmp, this.memoryFile);
    return { ok: removed };
  }
}

let singleton: KnowledgeService | undefined;

export function getKnowledgeService(): KnowledgeService {
  singleton ??= new KnowledgeService();
  return singleton;
}
