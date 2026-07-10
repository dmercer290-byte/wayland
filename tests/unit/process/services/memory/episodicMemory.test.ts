import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEpisodes,
  distillEpisodes,
  extractKeywords,
  formatEpisodeBlock,
} from '../../../../../src/process/services/memory/episodicMemory';
import { parseBlocks, scoreBlock, searchMemory } from '../../../../../src/process/services/memory/memoryRecall';
import { formatTranscriptBlock } from '../../../../../src/process/services/memory/transcriptFormat';
import type { TMessage } from '../../../../../src/common/chat/chatLib';

const msg = (conv: string, text: string, ts: number): string =>
  formatTranscriptBlock(conv, {
    id: `m-${ts}`,
    type: 'text',
    position: 'left',
    conversation_id: conv,
    createdAt: ts,
    content: { content: text },
  } as unknown as TMessage);

const T0 = Date.parse('2026-07-01T00:00:00Z');

describe('episodicMemory - distillEpisodes', () => {
  it('groups rotated transcript blocks into per-conversation episodes', () => {
    const archive =
      msg('alpha1234', 'Design the genesis engine release pipeline for android', T0) +
      msg('alpha1234', 'Decided: pin checksums and fail closed', T0 + 60_000) +
      msg('beta5678', 'Fix the baileys dependency', T0 + 120_000);

    const episodes = distillEpisodes(archive);
    expect(episodes).toHaveLength(2);
    const alpha = episodes.find((e) => e.conv === 'conv-alpha1234')!;
    expect(alpha.lines.length).toBeGreaterThanOrEqual(2);
    expect(alpha.from < alpha.to).toBe(true);
    expect(alpha.keywords).toContain('genesis');
  });

  it('samples head + tail when a conversation exceeds maxLines', () => {
    let archive = '';
    for (let i = 0; i < 20; i++) archive += msg('long0001', `step number ${i} of the plan`, T0 + i * 1000);
    const [episode] = distillEpisodes(archive, 6);
    expect(episode.lines.length).toBeLessThanOrEqual(6);
    expect(episode.lines.some((l) => l.includes('step number 0'))).toBe(true);
    expect(episode.lines.some((l) => l.includes('step number 19'))).toBe(true);
  });

  it('returns nothing for content without transcript blocks', () => {
    expect(distillEpisodes('# just a heading\nplain text')).toEqual([]);
  });
});

describe('episodicMemory - keywords and formatting', () => {
  it('extracts frequency-ranked keywords and drops stopwords', () => {
    const kw = extractKeywords('the release release release pipeline pipeline of the and to');
    expect(kw[0]).toBe('release');
    expect(kw[1]).toBe('pipeline');
    expect(kw).not.toContain('the');
  });

  it('renders an ijfw-style frontmatter block', () => {
    const block = formatEpisodeBlock({
      conv: 'conv-abc',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-01T01:00:00.000Z',
      lines: ['chat: hello'],
      keywords: ['hello'],
    });
    expect(block).toContain('type: episode');
    expect(block).toContain('tags: [episode, conv-abc]');
    expect(block).toContain('- chat: hello');
  });
});

describe('memoryRecall', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appendEpisodes writes a searchable episodes.md and searchMemory ranks it', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'episodic-'));
    const archive =
      msg('alpha1234', 'We rebuilt the android release signing pipeline', Date.now() - 3600_000) +
      msg('beta5678', 'Grocery list and unrelated chatter', Date.now() - 3600_000);
    await appendEpisodes(dir, distillEpisodes(archive));

    const raw = readFileSync(path.join(dir, 'episodes.md'), 'utf8');
    expect(raw).toContain('# Episodic Memory');

    const hits = await searchMemory(dir, 'android signing release');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].source).toBe('episode');
    expect(hits[0].body).toContain('android');
    const grocery = hits.find((h) => h.body.includes('Grocery'));
    if (grocery) expect(grocery.score).toBeLessThan(hits[0].score);
  });

  it('searchMemory returns empty for a memDir with no memory files', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'episodic-'));
    expect(await searchMemory(dir, 'anything')).toEqual([]);
  });

  it('scoreBlock combines overlap with recency (newer wins on a tie)', () => {
    const tokens = ['release', 'pipeline'];
    const old = scoreBlock(tokens, 'the release pipeline', '2020-01-01T00:00:00Z');
    const recent = scoreBlock(tokens, 'the release pipeline', new Date().toISOString());
    expect(recent).toBeGreaterThan(old);
    expect(scoreBlock(tokens, 'nothing relevant', new Date().toISOString())).toBe(0);
  });

  it('parseBlocks reads both episode and session blocks', () => {
    const md =
      formatEpisodeBlock({ conv: 'conv-x', from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z', lines: ['a'], keywords: [] }) +
      msg('yyy', 'session content', T0);
    const blocks = parseBlocks(md);
    expect(blocks.map((b) => b.source).toSorted()).toEqual(['episode', 'transcript']);
  });
});
