/**
 * Standalone stdio MCP server for ASI-Evolve (autonomous research framework).
 *
 * Spawned by the agent CLI as a stdio MCP server (solo AND team wcore
 * sessions, via WCoreManager). Unlike the hub-tools server it needs no
 * main-process state, so it drives the ASI-Evolve Python CLI directly:
 * research runs are long-lived, so `asi_evolve_run` launches one in the
 * background and returns a run id; `asi_evolve_status` / `asi_evolve_list`
 * report progress from the run's log.
 *
 * ASI_EVOLVE_DIR points at the framework checkout (see scripts/setup-asi-evolve.sh).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { buildRunArgs, inferRunState, newRunId, resolvePython, tailLines } from './asiEvolveFormat';

const DIR = process.env.ASI_EVOLVE_DIR || '';
if (!DIR) {
  process.stderr.write('[asi-evolve-mcp-stdio] ASI_EVOLVE_DIR is required\n');
  process.exit(1);
}
const RUNS_DIR = path.join(DIR, 'runs');

type RunMeta = {
  id: string;
  experiment: string;
  args: string[];
  startedAt: string;
  pid: number;
  exitCode: number | null;
  finishedAt: string | null;
};

function readMeta(id: string): RunMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, id, 'meta.json'), 'utf8')) as RunMeta;
  } catch {
    return null;
  }
}

function writeMeta(meta: RunMeta): void {
  fs.writeFileSync(path.join(RUNS_DIR, meta.id, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
}

function text(t: string, isError = false) {
  return { content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) };
}

const server = new McpServer({ name: 'wayland-asi-evolve', version: '1.0.0' }, { capabilities: { tools: {} } });

server.tool(
  'asi_evolve_run',
  `Launch an ASI-Evolve autonomous research run in the background and return its run id immediately (runs take a long time). ASI-Evolve cycles through knowledge retrieval, hypothesis design, experimentation, and analysis to discover novel solutions in a domain. Provide an experiment name, a step budget, and optionally an evaluation script path. Poll asi_evolve_status with the returned id to watch progress.`,
  {
    experiment: z.string().describe('Experiment name (letters/digits/._- only).'),
    steps: z.number().int().positive().describe('Number of research iterations to run.'),
    eval_script: z.string().optional().describe('Path to the evaluation script that scores candidate solutions.'),
    extra_args: z.array(z.string()).optional().describe('Additional raw CLI flags passed through to main.py.'),
  },
  async (a) => {
    try {
      if (!fs.existsSync(path.join(DIR, 'main.py'))) {
        return text(
          `ASI-Evolve is not installed at ${DIR}. Run scripts/setup-asi-evolve.sh (see docs/guides/asi-evolve.md) first.`,
          true
        );
      }
      const args = buildRunArgs({
        experiment: a.experiment as string,
        steps: a.steps as number,
        evalScript: a.eval_script as string | undefined,
        extraArgs: a.extra_args as string[] | undefined,
      });
      const id = newRunId(a.experiment as string, Date.now(), Math.random().toString(16).slice(2, 8));
      const runDir = path.join(RUNS_DIR, id);
      fs.mkdirSync(runDir, { recursive: true });
      const logPath = path.join(runDir, 'run.log');
      const out = fs.openSync(logPath, 'a');
      const python = resolvePython(DIR, fs.existsSync);

      const child = spawn(python, args, {
        cwd: DIR,
        detached: true,
        stdio: ['ignore', out, out],
        // Pass the whole env through so the framework sees any
        // OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL the session injected.
        env: process.env,
      });
      const meta: RunMeta = {
        id,
        experiment: a.experiment as string,
        args,
        startedAt: new Date().toISOString(),
        pid: child.pid ?? -1,
        exitCode: null,
        finishedAt: null,
      };
      writeMeta(meta);
      // Record completion when the child exits (this MCP process is long-lived).
      child.on('exit', (code) => {
        const m = readMeta(id);
        if (m) {
          m.exitCode = code ?? -1;
          m.finishedAt = new Date().toISOString();
          writeMeta(m);
        }
        try {
          fs.closeSync(out);
        } catch {
          /* already closed */
        }
      });
      child.unref();
      return text(`Started ASI-Evolve run "${id}" (pid ${meta.pid}). Poll with asi_evolve_status id="${id}".`);
    } catch (err) {
      return text(`Error: ${(err as Error).message}`, true);
    }
  }
);

server.tool(
  'asi_evolve_status',
  'Report an ASI-Evolve run\'s state (running / completed / failed) and the tail of its log.',
  { id: z.string().describe('Run id returned by asi_evolve_run.'), tail: z.number().int().positive().optional() },
  async (a) => {
    const id = a.id as string;
    const meta = readMeta(id);
    if (!meta) return text(`No ASI-Evolve run "${id}".`, true);
    let logTail = '';
    try {
      logTail = tailLines(fs.readFileSync(path.join(RUNS_DIR, id, 'run.log'), 'utf8'), (a.tail as number) ?? 40);
    } catch {
      /* no log yet */
    }
    const state = inferRunState(meta.exitCode, logTail);
    return text(
      `run: ${id}\nstate: ${state}\nstarted: ${meta.startedAt}${meta.finishedAt ? `\nfinished: ${meta.finishedAt}` : ''}\n\n--- log tail ---\n${logTail || '(no output yet)'}`
    );
  }
);

server.tool('asi_evolve_list', 'List recent ASI-Evolve runs (newest first).', {}, async () => {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(RUNS_DIR).toSorted().toReversed().slice(0, 20);
  } catch {
    return text('No ASI-Evolve runs yet.');
  }
  if (!ids.length) return text('No ASI-Evolve runs yet.');
  const rows = ids.map((id) => {
    const m = readMeta(id);
    const state = m ? inferRunState(m.exitCode, '') : 'unknown';
    return `- ${id}  [${state}]`;
  });
  return text(rows.join('\n'));
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`[asi-evolve-mcp-stdio] Fatal error: ${err}\n`);
  process.exit(1);
});
