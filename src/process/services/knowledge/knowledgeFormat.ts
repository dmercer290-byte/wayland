/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge Base format helpers (pure, no I/O) - the custom wiki + memory
 * that replaces the auto-synthesized IJFW wiki for users who prefer a
 * hand-authored, agent-writable knowledge base. Wiki pages are plain
 * markdown files linked with [[Page Name]]; memory entries are typed JSONL
 * records. Everything here is deterministic and unit-testable.
 */

export type WikiPageMeta = {
  slug: string;
  title: string;
  tags: string[];
  updatedMs: number;
  /** Slugs this page links to via [[wikilinks]]. */
  links: string[];
};

export type WikiPage = WikiPageMeta & {
  content: string;
  /** Slugs of pages that link here (computed from the whole wiki). */
  backlinks: string[];
};

export type WikiSearchHit = { slug: string; title: string; snippet: string };

export const MEMORY_KINDS = ['fact', 'decision', 'preference', 'howto', 'note'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type MemoryEntry = {
  id: string;
  ts: number;
  kind: MemoryKind;
  text: string;
  tags: string[];
  /** Where this came from (e.g. a conversation id or 'manual'). */
  source?: string;
};

const WIKILINK_RE = /\[\[([^\][|]+)(?:\|[^\][]*)?\]\]/g;

/** Filesystem-safe slug: lowercase, hyphenated, ascii-ish, bounded. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'untitled';
}

/** Unique slugs of every [[Page Name]] / [[Page Name|label]] in `content`. */
export function extractWikiLinks(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(WIKILINK_RE)) {
    out.add(slugify(m[1]));
  }
  return [...out];
}

/** First `# Heading` wins; falls back to the slug. */
export function titleFromContent(content: string, slug: string): string {
  const m = content.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1] : slug;
}

/** A `tags: a, b, c` line anywhere in the first 10 lines. */
export function tagsFromContent(content: string): string[] {
  const head = content.split('\n', 10);
  for (const line of head) {
    const m = line.match(/^tags:\s*(.+)$/i);
    if (m) {
      return m[1]
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return [];
}

/** Reverse the link graph: slug -> slugs of pages linking to it. */
export function buildBacklinks(pages: Array<Pick<WikiPageMeta, 'slug' | 'links'>>): Map<string, string[]> {
  const back = new Map<string, string[]>();
  for (const page of pages) {
    for (const target of page.links) {
      if (target === page.slug) continue;
      const list = back.get(target) ?? [];
      list.push(page.slug);
      back.set(target, list);
    }
  }
  return back;
}

/** Case-insensitive substring match over title + content. */
export function pageMatches(query: string, title: string, content: string): boolean {
  const q = query.toLowerCase();
  return title.toLowerCase().includes(q) || content.toLowerCase().includes(q);
}

/** Short context window around the first match, for search results. */
export function snippetAround(content: string, query: string, radius = 60): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0)
    return content
      .slice(0, radius * 2)
      .replace(/\s+/g, ' ')
      .trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + query.length + radius);
  return (
    (start > 0 ? '…' : '') + content.slice(start, end).replace(/\s+/g, ' ').trim() + (end < content.length ? '…' : '')
  );
}

export function serializeMemoryEntry(entry: MemoryEntry): string {
  return JSON.stringify(entry);
}

/** Parse one JSONL line; malformed lines return undefined (never throw). */
export function parseMemoryLine(line: string): MemoryEntry | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const raw = JSON.parse(trimmed) as Partial<MemoryEntry>;
    if (typeof raw.id !== 'string' || typeof raw.text !== 'string' || typeof raw.ts !== 'number') return undefined;
    const kind = MEMORY_KINDS.includes(raw.kind as MemoryKind) ? (raw.kind as MemoryKind) : 'note';
    const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [];
    return {
      id: raw.id,
      ts: raw.ts,
      kind,
      text: raw.text,
      tags,
      source: typeof raw.source === 'string' ? raw.source : undefined,
    };
  } catch {
    return undefined;
  }
}

export function memoryMatches(entry: MemoryEntry, query?: string, kind?: MemoryKind, tag?: string): boolean {
  if (kind && entry.kind !== kind) return false;
  if (tag && !entry.tags.includes(tag.toLowerCase())) return false;
  if (query) {
    const q = query.toLowerCase();
    if (!entry.text.toLowerCase().includes(q) && !entry.tags.some((t) => t.includes(q))) return false;
  }
  return true;
}
