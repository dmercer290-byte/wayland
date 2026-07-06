# Ornith Harness — Quickstart

A recursive scaffold harness: the model's whole reply is run as Python.
If it crashes, the error goes back to the model, which must reflect and
fix it — resuming from its checkpoint, never restarting.

Two files. No pip installs. Python 3.10+.

- `ornith_harness.py` — the harness (also a CLI)
- `test_ornith_harness.py` — run `python3 test_ornith_harness.py` → `ALL PASS`

## Run it (Ollama example)

```bash
python3 ornith_harness.py \
  --task "Read /data/logs.txt and write a summary to STATE_DIR/report.md" \
  --model-url http://localhost:11434/v1 \
  --model qwen2.5-coder:14b \
  --run-dir ./runs/first-try
```

OpenRouter / ZenMux: same command, change `--model-url` and add
`--api-key` (or set `ORNITH_API_KEY`).

## The verifier (do not skip for training)

Without one, "success" = the scaffold exited 0 — which a model can fake.
Write a small script that checks the real result and add `--verifier`:

```python
# verifier.py — checks the work; the model never sees this file
import os, sys
report = os.path.join(os.environ["STATE_DIR"], "report.md")
if not os.path.exists(report):
    sys.exit(1)          # reject -> reward 0, loop continues
print(1.0)               # last stdout line = reward (float)
```

## Batches for training

```bash
python3 ornith_harness.py --task-file task.txt \
  --model-url http://localhost:11434/v1 --model qwen2.5-coder:14b \
  --verifier verifier.py --rollouts 32 --max-workers 4 \
  --run-dir ./runs/exp1
```

- Each rollout gets `rollout_NNNN/` with `trajectory.jsonl` (every prompt,
  reflection, scaffold, result, reward, tokens) and `summary.json`.
- **Resumable**: re-run the same command after a crash — finished
  rollouts are skipped.
- Add `--docker-image python:3.12-slim` to run each scaffold in a
  no-network, read-only container (needs Docker on the host). Do this
  before any big unattended run.

## Key ideas

| Thing | What it means |
| --- | --- |
| `STATE_DIR` | The only folder that survives between attempts. Scaffolds checkpoint here and resume from it. |
| `<reflection>` block | After a failure the model must explain why before new code runs. No reflection → not executed. |
| Loop detector | Same error 3× → rollout aborts (`loop_detected`) instead of burning tokens. |
| Reward | Verifier exit 0 = pass; its last stdout line (a float) is the score. Reject = 0. |
| Exit codes | 124 timeout, 125 broke the reflection contract. |

## Using it from Python

```python
from ornith_harness import OrnithHarness, OpenAICompatClient

client = OpenAICompatClient("http://localhost:11434/v1", "qwen2.5-coder:14b")
h = OrnithHarness(client, task="...", verifier_path="verifier.py")
final = h.run(max_iterations=8)
print(final.ok, final.reward, h.total_completion_tokens)
```

Any object with `complete(prompt) -> str | ModelReply` works as a client —
including a policy under RL training.
