/**
 * Episodic memory sidecar.
 *
 * The transcript logger mirrors every message into transcript.md, which
 * rotates into gzip archives once it grows past the size cap. Rotation is
 * exactly the moment detail leaves the model's reach - the archives are
 * compressed and unsearchable in practice. This module distills the rotated
 * slice into compact per-conversation "episodes" appended to episodes.md:
 * a small, append-only, human-readable index that persists forever and is
 * cheap to search (see memoryRecall.ts).
 *
 * Pure functions (distill/parse/score) are exported for unit tests; only
 * appendEpisodes touches the filesystem.
 */

import fs from 'fs';
import path from 'path';

export type Episode = {
  /** conv-<id> tag as it appears in transcript blocks. */
  conv: string;
  /** ISO timestamps of the first and last block in the episode. */
  from: string;
  to: string;
  /** One-line summaries sampled from the conversation (head + tail). */
  lines: string[];
  /** Most frequent salient terms across the episode's bodies. */
  keywords: string[];
};

const BLOCK_RE = /^---\ntype: session\nsummary: (.*)\nstored: (.*)\ntags: \[transcript, [^,\]]+, (conv-[A-Za-z0-9_-]+)\]\n---\n([\s\S]*?)(?=\n---\ntype: session\n|$)/gm;

const STOPWORDS = new Set(
  ('the a an and or but if then else for of to in on at by with from as is are was were be been i you it this that ' +
    'these those we they he she not no yes do does did done can could should would will just so what which who whom ' +
    'how when where why all any some more most other into out up down over under again once here there').split(' ')
);

/** Extract salient keywords from free text by frequency, stopword-filtered. */
export function extractKeywords(text: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9_./-]+/)) {
    const word = raw.trim();
    if (word.length < 3 || word.length > 40 || STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}

/** Distill a rotated transcript slice into per-conversation episodes. */
export function distillEpisodes(archiveMarkdown: string, maxLines = 8): Episode[] {
  type Acc = { summaries: string[]; bodies: string[]; from: string; to: string };
  const byConv = new Map<string, Acc>();

  for (const m of archiveMarkdown.matchAll(BLOCK_RE)) {
    const [, rawSummary, stored, conv, body] = m;
    let summary = rawSummary.trim();
    // summary is JSON.stringify'd by the transcript formatter.
    try {
      summary = JSON.parse(summary);
    } catch {
      /* keep raw */
    }
    const acc = byConv.get(conv) ?? { summaries: [], bodies: [], from: stored, to: stored };
    acc.summaries.push(summary);
    acc.bodies.push(body);
    if (stored < acc.from) acc.from = stored;
    if (stored > acc.to) acc.to = stored;
    byConv.set(conv, acc);
  }

  const episodes: Episode[] = [];
  for (const [conv, acc] of byConv) {
    // Head + tail sampling: openings carry intent, endings carry outcomes.
    const head = acc.summaries.slice(0, Math.ceil(maxLines / 2));
    const tail = acc.summaries.slice(-Math.floor(maxLines / 2));
    const lines = [...new Set([...head, ...tail])];
    episodes.push({
      conv,
      from: acc.from,
      to: acc.to,
      lines,
      keywords: extractKeywords(acc.bodies.join('\n')),
    });
  }
  return episodes;
}

/** Render an episode as an ijfw-style frontmatter block. */
export function formatEpisodeBlock(e: Episode): string {
  return [
    '---',
    'type: episode',
    `summary: ${JSON.stringify(`${e.conv} ${e.from.slice(0, 10)}: ${e.lines[0] ?? ''}`.slice(0, 140))}`,
    `stored: ${e.to}`,
    `tags: [episode, ${e.conv}]`,
    `keywords: [${e.keywords.join(', ')}]`,
    '---',
    ...e.lines.map((l) => `- ${l}`),
    '',
    '',
  ].join('\n');
}

export const EPISODES_FILE = 'episodes.md';
const EPISODES_HEADER = '<!-- ijfw-schema: v1 -->\n# Episodic Memory\n\n';

/** Append distilled episodes to episodes.md (creates it with a header). */
export async function appendEpisodes(memDir: string, episodes: Episode[]): Promise<void> {
  if (!episodes.length) return;
  const filePath = path.join(memDir, EPISODES_FILE);
  let header = '';
  try {
    await fs.promises.access(filePath);
  } catch {
    header = EPISODES_HEADER;
  }
  const blocks = episodes.map(formatEpisodeBlock).join('');
  await fs.promises.appendFile(filePath, header + blocks, 'utf8');
}
