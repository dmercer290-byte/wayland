import { describe, expect, it } from 'vitest';
import {
  buildRunArgs,
  inferRunState,
  newRunId,
  resolveAsiEvolveDir,
  resolvePython,
  tailLines,
} from '../../../../src/process/asiEvolve/asiEvolveFormat';

describe('asiEvolveFormat - resolveAsiEvolveDir', () => {
  it('prefers ASI_EVOLVE_DIR when set', () => {
    expect(resolveAsiEvolveDir({ ASI_EVOLVE_DIR: '/opt/ase' }, '/data')).toBe('/opt/ase');
  });
  it('falls back to <userData>/asi-evolve', () => {
    expect(resolveAsiEvolveDir({}, '/data/user')).toBe('/data/user/asi-evolve');
  });
  it('ignores a blank env override', () => {
    expect(resolveAsiEvolveDir({ ASI_EVOLVE_DIR: '  ' }, '/data')).toBe('/data/asi-evolve');
  });
});

describe('asiEvolveFormat - resolvePython', () => {
  it('uses the venv python when present', () => {
    const exists = (p: string) => p === '/d/.venv/bin/python';
    expect(resolvePython('/d', exists)).toBe('/d/.venv/bin/python');
  });
  it('falls back to system python3 when no venv', () => {
    expect(resolvePython('/d', () => false)).toBe('python3');
  });
});

describe('asiEvolveFormat - buildRunArgs', () => {
  it('builds the README invocation', () => {
    expect(buildRunArgs({ experiment: 'arch-search', steps: 50, evalScript: 'eval/mmlu.py' })).toEqual([
      'main.py',
      '--experiment',
      'arch-search',
      '--steps',
      '50',
      '--eval-script',
      'eval/mmlu.py',
    ]);
  });
  it('omits eval-script when not given and appends extra_args', () => {
    expect(buildRunArgs({ experiment: 'e1', steps: 3, extraArgs: ['--wandb', 'off' ] })).toEqual([
      'main.py',
      '--experiment',
      'e1',
      '--steps',
      '3',
      '--wandb',
      'off',
    ]);
  });
  it('rejects an empty experiment', () => {
    expect(() => buildRunArgs({ experiment: '  ', steps: 1 })).toThrow(/experiment is required/);
  });
  it('rejects an experiment with shell/path metacharacters', () => {
    expect(() => buildRunArgs({ experiment: 'a; rm -rf /', steps: 1 })).toThrow(/letters, digits/);
    expect(() => buildRunArgs({ experiment: '../escape', steps: 1 })).toThrow(/letters, digits/);
  });
  it('rejects non-positive or non-integer steps', () => {
    expect(() => buildRunArgs({ experiment: 'e', steps: 0 })).toThrow(/positive integer/);
    expect(() => buildRunArgs({ experiment: 'e', steps: 2.5 })).toThrow(/positive integer/);
  });
});

describe('asiEvolveFormat - newRunId', () => {
  it('is filesystem-safe and carries the experiment + timestamp', () => {
    const id = newRunId('arch/search', Date.parse('2026-07-12T04:09:39Z'), 'ab12cd');
    expect(id).toBe('archsearch-2026-07-12T04-09-39-000Z-ab12cd');
    expect(id).not.toMatch(/[/:.]/);
  });
});

describe('asiEvolveFormat - inferRunState', () => {
  it('is running while the exit code is unknown', () => {
    expect(inferRunState(null, 'step 3/50...')).toBe('running');
  });
  it('is completed on a clean zero exit', () => {
    expect(inferRunState(0, 'done. best score 0.82')).toBe('completed');
  });
  it('is failed on a nonzero exit', () => {
    expect(inferRunState(1, 'partial output')).toBe('failed');
  });
  it('is failed when a python traceback is in the log even on exit 0', () => {
    expect(inferRunState(0, 'Traceback (most recent call last):\n  File ...')).toBe('failed');
  });
});

describe('asiEvolveFormat - tailLines', () => {
  it('keeps only the last N lines', () => {
    expect(tailLines('a\nb\nc\nd', 2)).toBe('c\nd');
  });
  it('returns everything when fewer than N lines', () => {
    expect(tailLines('only', 5)).toBe('only');
  });
});
