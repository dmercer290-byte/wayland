/**
 * Memory recall: search the persistent memory sidecars (episodes.md + the
 * live transcript.md) for content relevant to a query. Token-overlap scoring
 * with a recency boost - no embeddings, no network, fast enough to run on
 * every lookup. Exposed to the renderer/agents through the memory bridge
 * (memoryArchiveBridge.ts, ipcBridge.memory.searchMemory).
 */

import fs from 'fs';
import path from 'path';
import { extractKeywords } from './episodicMemory';

export type RecallHit = {
  source: 'episode' | 'transcript';
  summary: string;
  body: string;
  stored: string;
  score: number;
};

/** Generic frontmatter block: captures summary, stored, and body. */
const ANY_BLOCK_RE = /^---\ntype: (episode|session)\nsummary: (.*)\nstored: (.*)\n[\s\S]*?---\n([\s\S]*?)(?=\n---\ntype: |$)/gm;

/** Score a block against query tokens: overlap count + light recency boost. */
export function scoreBlock(queryTokens: string[], text: string, storedIso: string, now = Date.now()): number {
  if (!queryTokens.length) return 0;
  const haystack = text.toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) hits += 1;
  }
  if (hits === 0) return 0;
  const overlap = hits / queryTokens.length;
  const ageDays = Math.max(0, (now - Date.parse(storedIso)) / 86_400_000);
  const recency = 1 / (1 + ageDays / 30); // halves roughly monthly
  return overlap * 0.8 + recency * 0.2;
}

export function parseBlocks(markdown: string): Array<Omit<RecallHit, 'score'>> {
  const out: Array<Omit<RecallHit, 'score'>> = [];
  for (const m of markdown.matchAll(ANY_BLOCK_RE)) {
    const [, type, rawSummary, stored, body] = m;
    let summary = rawSummary.trim();
    try {
      summary = JSON.parse(summary);
    } catch {
      /* keep raw */
    }
    out.push({
      source: type === 'episode' ? 'episode' : 'transcript',
      summary,
      stored: stored.trim(),
      body: body.trim().slice(0, 2000),
    });
  }
  return out;
}

/** Search episodes.md + transcript.md under memDir for the query. */
export async function searchMemory(memDir: string, query: string, limit = 8): Promise<RecallHit[]> {
  const queryTokens = [...new Set([...extractKeywords(query, 16), ...query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)])];
  const files = ['episodes.md', 'transcript.md'];
  const hits: RecallHit[] = [];
  for (const file of files) {
    let content = '';
    try {
      content = await fs.promises.readFile(path.join(memDir, file), 'utf8');
    } catch {
      continue;
    }
    for (const block of parseBlocks(content)) {
      const score = scoreBlock(queryTokens, `${block.summary}\n${block.body}`, block.stored);
      if (score > 0) hits.push({ ...block, score });
    }
  }
  return hits.toSorted((a, b) => b.score - a.score).slice(0, limit);
}
