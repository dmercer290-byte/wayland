"""Example held-out verifier — copy and edit for your task.

The harness runs this AFTER a scaffold exits 0, with the same STATE_DIR.
The scaffold never sees this file. Rules:
  - exit 0  -> the work is accepted
  - exit !=0 -> rejected; the harness sends your stderr back to the model
  - last stdout line, if it is a float, becomes the step reward
"""

import os
import sys

state_dir = os.environ["STATE_DIR"]

# --- EDIT BELOW: check whatever your task was supposed to produce --------
report = os.path.join(state_dir, "report.md")

if not os.path.exists(report):
    print("report.md was not created in STATE_DIR", file=sys.stderr)
    sys.exit(1)

text = open(report, encoding="utf-8").read()
if len(text.strip()) < 50:
    print(f"report.md is only {len(text.strip())} chars - not a real report", file=sys.stderr)
    sys.exit(1)

# Optional graded reward: longer/better output can score higher (0.0 - 1.0).
score = min(1.0, len(text) / 2000)
print(score)
