/**
 * Pure helpers for the ASI-Evolve MCP integration.
 *
 * ASI-Evolve (github.com/GAIR-NLP/ASI-Evolve, Apache-2.0) is a standalone
 * Python autonomous-research framework. We do NOT vendor it - it lives in its
 * own checkout with its own venv, and the MCP server (asiEvolveMcpStdio.ts)
 * shells out to its CLI. These functions build the invocation and parse run
 * state; they touch no filesystem so they are unit-tested directly.
 */

import path from 'path';

/**
 * Resolve the ASI-Evolve install directory: explicit ASI_EVOLVE_DIR wins,
 * otherwise <userData>/asi-evolve. The setup script clones + installs there.
 */
export function resolveAsiEvolveDir(env: Record<string, string | undefined>, userDataDir: string): string {
  const explicit = env.ASI_EVOLVE_DIR?.trim();
  if (explicit) return explicit;
  return path.join(userDataDir, 'asi-evolve');
}

/** The venv python if the setup script created one, else the system python3. */
export function resolvePython(dir: string, exists: (p: string) => boolean): string {
  const venv = path.join(dir, '.venv', 'bin', 'python');
  return exists(venv) ? venv : 'python3';
}

export type RunParams = {
  experiment: string;
  steps: number;
  evalScript?: string;
  extraArgs?: string[];
};

/**
 * Build the argv for `python main.py ...`. Args are passed to the child as a
 * real argv array (no shell), so this validates types rather than escaping.
 * Mirrors the README's `--experiment <name> --steps <N> --eval-script <path>`
 * and keeps an extraArgs escape hatch for flags the framework adds later.
 */
export function buildRunArgs(params: RunParams): string[] {
  const experiment = params.experiment?.trim();
  if (!experiment) throw new Error('experiment is required');
  if (!/^[A-Za-z0-9._-]+$/.test(experiment)) {
    throw new Error('experiment must contain only letters, digits, dot, dash, underscore');
  }
  if (!Number.isInteger(params.steps) || params.steps <= 0) {
    throw new Error('steps must be a positive integer');
  }
  const args = ['main.py', '--experiment', experiment, '--steps', String(params.steps)];
  if (params.evalScript && params.evalScript.trim()) {
    args.push('--eval-script', params.evalScript.trim());
  }
  if (params.extraArgs?.length) {
    for (const a of params.extraArgs) {
      if (typeof a !== 'string') throw new Error('extraArgs must be strings');
      args.push(a);
    }
  }
  return args;
}

/** A filesystem-safe, sortable run id: <experiment>-<UTC compact>-<rand>. */
export function newRunId(experiment: string, now: number, rand: string): string {
  const safe = experiment.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'run';
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `${safe}-${stamp}-${rand}`;
}

export type RunState = 'running' | 'completed' | 'failed';

/**
 * Infer run state from the recorded exit code plus a tail of the log. A null
 * exit means the process record is still open (running). ASI-Evolve prints
 * tracebacks on failure, so a nonzero exit or a Traceback marker is failure.
 */
export function inferRunState(exitCode: number | null, logTail: string): RunState {
  if (exitCode === null) return 'running';
  if (exitCode !== 0) return 'failed';
  if (/\bTraceback \(most recent call last\)/.test(logTail)) return 'failed';
  return 'completed';
}

/** Keep the last N lines of a log for compact status reporting. */
export function tailLines(text: string, n: number): string {
  const lines = text.split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}
