"""Smoke tests for ornith_harness.

Covers the original loop (fail -> reflect -> resume-from-checkpoint -> pass)
plus the five training-oriented additions: held-out verifier vs reward
hacking, loop detection, batch rollouts, token accounting, docker preset.
"""

from __future__ import annotations

import json
from pathlib import Path

from ornith_harness import (
    LoopDetector,
    ModelClient,
    ModelReply,
    OpenAICompatClient,
    OrnithHarness,
    SandboxConfig,
    LocalSandbox,
    VerifierTamperedError,
    main as cli_main,
    run_batch,
)

SCAFFOLD_V1 = """
import json, os
state = os.environ["STATE_DIR"]
# checkpoint partial progress BEFORE crashing
with open(os.path.join(state, "checkpoint.json"), "w") as f:
    json.dump({"progress": 21}, f)
raise RuntimeError("boom at step 21")
"""

SCAFFOLD_V2 = """<reflection>
The previous scaffold crashed with RuntimeError("boom at step 21") after
checkpointing progress=21. The fix resumes from the checkpoint instead of
recomputing, and completes the remaining half.
</reflection>
import json, os
state = os.environ["STATE_DIR"]
with open(os.path.join(state, "checkpoint.json")) as f:
    progress = json.load(f)["progress"]
assert progress == 21, "resume state missing - would mean the task restarted"
with open(os.path.join(state, "answer.txt"), "w") as f:
    f.write(str(progress * 2))
print("resumed from", progress, "-> final:", progress * 2)
"""

# A reward hack: exits 0 immediately without doing any work.
LAZY_HACK = "import sys\nsys.exit(0)\n"

HONEST_AFTER_REJECT = """<reflection>
My previous scaffold exited 0 without writing answer.txt, so the held-out
verifier rejected it. This one actually computes and writes the answer.
</reflection>
import os
with open(os.path.join(os.environ["STATE_DIR"], "answer.txt"), "w") as f:
    f.write("42")
"""

VERIFIER = """
import os, sys
path = os.path.join(os.environ["STATE_DIR"], "answer.txt")
if not os.path.exists(path):
    print("answer.txt missing", file=sys.stderr)
    sys.exit(1)
value = open(path).read().strip()
if value != "42":
    print(f"wrong answer: {value}", file=sys.stderr)
    sys.exit(1)
print(0.9)  # last stdout line = float reward
"""

SAME_CRASH = "raise ValueError('stuck error 7')\n"
SAME_CRASH_REFLECTED = (
    "<reflection>\nIt failed with ValueError; trying again.\n</reflection>\n" + SAME_CRASH
)

NO_REFLECTION = "print('i refuse to reflect')\n"


class ScriptedModel:
    def __init__(self, replies: list[str | ModelReply]) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []

    def complete(self, prompt: str) -> str | ModelReply:
        self.prompts.append(prompt)
        return self.replies.pop(0)


def _write_verifier(tmp: Path) -> Path:
    tmp.mkdir(parents=True, exist_ok=True)
    path = tmp / "verifier.py"
    path.write_text(VERIFIER, encoding="utf-8")
    return path


def test_recursive_repair() -> None:
    model = ScriptedModel([SCAFFOLD_V1, SCAFFOLD_V2])
    h = OrnithHarness(model, task="Compute the answer, checkpointing to STATE_DIR.")
    s1 = h.run_recursive_step(None)
    assert not s1.ok and "boom at step 21" in s1.record.stderr
    s2 = h.run_recursive_step(s1)
    # failure record was injected as primary context
    assert "boom at step 21" in model.prompts[1]
    assert "PREVIOUS EXECUTION" in model.prompts[1]
    assert s2.reflection and "checkpoint" in s2.reflection
    assert s2.ok and "resumed from 21 -> final: 42" in s2.record.stdout
    assert Path(h.run_dir, "trajectory.jsonl").read_text().count("\n") == 2
    print("PASS recursive repair + state resume")


def test_reflection_hook_enforced() -> None:
    model = ScriptedModel([SCAFFOLD_V1, NO_REFLECTION, NO_REFLECTION, NO_REFLECTION])
    h = OrnithHarness(model, task="anything")
    s1 = h.run_recursive_step(None)
    s2 = h.run_recursive_step(s1)
    assert s2.record.exit_code == 125 and "reflection contract" in s2.record.stderr
    assert any("omitted the mandatory <reflection>" in p for p in model.prompts[2:])
    print("PASS refinement hook fails closed")


def test_timeout_and_isolation() -> None:
    model = ScriptedModel(["import time\ntime.sleep(30)\n"])
    h = OrnithHarness(
        model,
        task="hang",
        sandbox=LocalSandbox(SandboxConfig(timeout_s=2.0, cpu_seconds=2)),
    )
    s = h.run_recursive_step(None)
    assert s.record.timed_out and s.record.exit_code == 124
    print("PASS wall-clock timeout")


def test_verifier_blocks_reward_hack(tmp: Path) -> None:
    model = ScriptedModel([LAZY_HACK, HONEST_AFTER_REJECT])
    h = OrnithHarness(
        model,
        task="Write the answer 42 to STATE_DIR/answer.txt.",
        verifier_path=_write_verifier(tmp),
        run_dir=tmp / "hack-run",
    )
    s1 = h.run_recursive_step(None)
    # exit 0 alone is NOT success: verifier rejected, reward 0
    assert s1.record.ok and s1.verification is not None and not s1.verification.ok
    assert not s1.ok and s1.reward == 0.0
    s2 = h.run_recursive_step(s1)
    # rejection was surfaced to the model as the primary context
    assert "VERIFIER REJECTED" in model.prompts[1]
    assert "answer.txt missing" in model.prompts[1]
    assert s2.ok and s2.reward == 0.9  # verifier's printed float
    print("PASS verifier blocks reward hacking + float reward")


def test_verifier_tamper_detected(tmp: Path) -> None:
    verifier = _write_verifier(tmp / "t")
    # honest scaffold, no reflection needed on the first step
    model = ScriptedModel(["import os\nopen(os.path.join(os.environ['STATE_DIR'],'answer.txt'),'w').write('42')\n"])
    h = OrnithHarness(model, task="write it", verifier_path=verifier, run_dir=tmp / "tamper-run")
    verifier.write_text(VERIFIER + "\n# tampered\n", encoding="utf-8")
    try:
        h.run_recursive_step(None)
    except VerifierTamperedError:
        print("PASS verifier tampering detected")
        return
    raise AssertionError("tampered verifier was not detected")


def test_loop_detection() -> None:
    replies = [SAME_CRASH] + [SAME_CRASH_REFLECTED] * 4
    model = ScriptedModel(replies)
    h = OrnithHarness(model, task="doomed", loop_detector=LoopDetector(max_repeats=3))
    final = h.run(max_iterations=10)
    assert final.aborted_reason and "loop_detected" in final.aborted_reason
    assert final.iteration == 3  # aborted at the 3rd identical failure
    # the escalating note reached the model before the abort
    assert any("exact failure" in p or "identical" in p for p in model.prompts)
    print("PASS loop detection aborts a stuck rollout")


def test_token_accounting() -> None:
    model = ScriptedModel([
        ModelReply(SCAFFOLD_V1, prompt_tokens=100, completion_tokens=50),
        ModelReply(SCAFFOLD_V2, prompt_tokens=300, completion_tokens=80),
    ])
    h = OrnithHarness(model, task="Compute the answer, checkpointing to STATE_DIR.")
    s1 = h.run_recursive_step(None)
    s2 = h.run_recursive_step(s1)
    assert s1.usage.prompt_tokens == 100 and s2.usage.completion_tokens == 80
    assert h.total_prompt_tokens == 400 and h.total_completion_tokens == 130
    last = json.loads(Path(h.run_dir, "trajectory.jsonl").read_text().splitlines()[-1])
    assert last["totals"] == {"prompt_tokens": 400, "completion_tokens": 130}
    assert last["usage"]["model_calls"] == 1
    print("PASS token accounting in states + trajectory")


def test_batch_rollouts(tmp: Path) -> None:
    verifier = _write_verifier(tmp / "b")

    def factory(rollout_id: int) -> ModelClient:
        # even rollouts succeed after one repair; odd ones hack then repent
        if rollout_id % 2 == 0:
            return ScriptedModel([SCAFFOLD_V1, SCAFFOLD_V2])
        return ScriptedModel([LAZY_HACK, HONEST_AFTER_REJECT])

    results = run_batch(
        factory,
        "Write the answer 42 to STATE_DIR/answer.txt.",
        n_rollouts=4,
        run_root=tmp / "batch",
        verifier_path=verifier,
        max_workers=4,
    )
    assert len(results) == 4 and all(r.ok for r in results)
    assert all(r.iterations == 2 for r in results)
    for r in results:
        summary = json.loads(Path(r.run_dir, "summary.json").read_text())
        assert summary["ok"] is True
        assert Path(r.run_dir, "trajectory.jsonl").exists()
    # per-rollout seed is injected into the sandbox env
    first_traj = json.loads(Path(results[0].run_dir, "trajectory.jsonl").read_text().splitlines()[0])
    assert first_traj["iteration"] == 1
    print("PASS batch rollouts (4 parallel, all recovered)")


def test_docker_preset_shape() -> None:
    cfg = SandboxConfig.docker_preset(memory="2g")
    prefix = cfg.command_prefix
    assert prefix[0] == "docker" and "--network=none" in prefix
    assert "--read-only" in prefix and "--cap-drop=ALL" in prefix and "--memory=2g" in prefix
    # placeholders format cleanly
    rendered = [p.format(workdir="/w", state_dir="/s", script_dir="/c") for p in prefix]
    assert "/c:/c:ro" in rendered and "/s:/s:rw" in rendered and "/w:/w:rw" in rendered
    assert "STATE_DIR=/s" in rendered
    print("PASS docker preset shape (execution requires a docker host)")


def _serve_openai_compat(replies: list[str]):
    """Tiny OpenAI-compatible endpoint on a random port; returns (server, port)."""
    import http.server
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert body["messages"][0]["role"] == "user"
            reply = replies.pop(0)
            out = json.dumps({
                "choices": [{"message": {"role": "assistant", "content": reply}}],
                "usage": {"prompt_tokens": 11, "completion_tokens": 7},
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *a: object) -> None:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


def test_openai_compat_client(tmp: Path) -> None:
    server, port = _serve_openai_compat([SCAFFOLD_V1, SCAFFOLD_V2])
    try:
        client = OpenAICompatClient(f"http://127.0.0.1:{port}/v1", "test-model")
        h = OrnithHarness(client, task="Compute the answer, checkpointing to STATE_DIR.",
                          run_dir=tmp / "http-run")
        final = h.run(max_iterations=5)
        assert final.ok and final.iteration == 2
        assert h.total_prompt_tokens == 22 and h.total_completion_tokens == 14
    finally:
        server.shutdown()
    print("PASS OpenAI-compatible HTTP client end-to-end")


def test_batch_resume(tmp: Path) -> None:
    verifier = _write_verifier(tmp / "r")
    calls: list[int] = []

    def factory(rollout_id: int) -> ModelClient:
        calls.append(rollout_id)
        return ScriptedModel([SCAFFOLD_V1, SCAFFOLD_V2])

    kwargs = dict(n_rollouts=3, run_root=tmp / "resume", verifier_path=verifier, max_workers=2)
    first = run_batch(factory, "Write the answer 42 to STATE_DIR/answer.txt.", **kwargs)
    assert len(first) == 3 and sorted(calls) == [0, 1, 2]
    calls.clear()
    second = run_batch(factory, "Write the answer 42 to STATE_DIR/answer.txt.", **kwargs)
    assert calls == []  # nothing re-ran: all loaded from summary.json
    assert [r.rollout_id for r in second] == [0, 1, 2] and all(r.ok for r in second)
    print("PASS batch resume skips completed rollouts")


def test_cli_single_rollout(tmp: Path) -> None:
    server, port = _serve_openai_compat([SCAFFOLD_V1, SCAFFOLD_V2])
    try:
        code = cli_main([
            "--task", "Compute the answer, checkpointing to STATE_DIR.",
            "--model-url", f"http://127.0.0.1:{port}/v1",
            "--model", "test-model",
            "--run-dir", str(tmp / "cli-run"),
            "--max-iterations", "5",
        ])
        assert code == 0
        assert (tmp / "cli-run" / "trajectory.jsonl").exists()
    finally:
        server.shutdown()
    print("PASS CLI single rollout exits 0")


def test_run_driver() -> None:
    model = ScriptedModel([SCAFFOLD_V1, SCAFFOLD_V2])
    h = OrnithHarness(model, task="Compute the answer, checkpointing to STATE_DIR.")
    final = h.run(max_iterations=5)
    assert final.ok and final.iteration == 2
    print("PASS run() driver stops on success")


if __name__ == "__main__":
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ornith-tests-"))
    test_recursive_repair()
    test_reflection_hook_enforced()
    test_timeout_and_isolation()
    test_verifier_blocks_reward_hack(tmp)
    test_verifier_tamper_detected(tmp)
    test_loop_detection()
    test_token_accounting()
    test_batch_rollouts(tmp)
    test_docker_preset_shape()
    test_openai_compat_client(tmp)
    test_batch_resume(tmp)
    test_cli_single_rollout(tmp)
    test_run_driver()
    print("ALL PASS")
