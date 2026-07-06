"""Ornith-style recursive control-scaffold harness.

The model's entire output is treated as an executable Python "Control
Scaffold" (no JSON/XML tool-calling tags). Each iteration:

    1. The previous scaffold's execution record (stdout, stderr, exit code,
       traceback) is injected as the PRIMARY context of the next prompt.
    2. If the previous run failed, the model MUST first print a
       <reflection>...</reflection> block explaining the failure before the
       new scaffold body (the Refinement Hook enforces this and re-prompts
       when it is missing).
    3. The new scaffold is written to a file inside an isolated working
       directory and executed in a separate, resource-limited interpreter.
    4. The loop RESUMES from the failure state — the task prompt plus the
       full failure record travel forward; the task is never restarted from
       scratch. State the scaffold wants to survive across iterations must
       be persisted to files under STATE_DIR (injected env var), which the
       harness carries from run to run.

Training-oriented extras
------------------------
- **Held-out verifier / reward** (`verifier_path`): a harness-owned script
  the scaffold never authors. After a scaffold exits 0, the verifier runs in
  the same sandbox against STATE_DIR; exit 0 = pass, and its last stdout
  line, when it parses as a float, is the step reward. A scaffold that
  merely exits 0 without doing the work is REJECTED and the loop continues
  — this is the guard against reward hacking. The verifier file is hashed
  at harness construction and re-hashed before every run; any mutation
  raises `VerifierTamperedError`.
- **Loop detection**: repeated failure signatures (same terminal error) or
  re-submitted identical scaffolds first inject an escalating harness note,
  then abort the rollout (`aborted_reason` set) so a stuck policy stops
  burning tokens.
- **Batch rollouts** (`run_batch`): thread-pooled parallel rollouts, one
  run directory + trajectory file per rollout, per-rollout seeds via the
  model factory and ORNITH_SEED in the sandbox env.
- **Token accounting**: a `ModelClient` may return `ModelReply` (text +
  usage) instead of a bare string; per-step and running totals land in
  `trajectory.jsonl`.
- **Container preset**: `SandboxConfig.docker_preset()` wraps every
  execution in `docker run --network=none --read-only --cap-drop=ALL ...`
  for kernel-level containment on a training farm.

Isolation notes (read before production RL use)
-----------------------------------------------
`LocalSandbox` without a `command_prefix` gives per-run process isolation:
a scrubbed environment, `python -I` (isolated mode), a fresh scratch CWD,
rlimits (CPU, memory, file size, open files) and a wall-clock timeout. It
does NOT give kernel-level containment — a scaffold can still read
world-readable files and use the network. For an RL training farm, use
`SandboxConfig.docker_preset()` (or your own `command_prefix` invoking
gVisor/bubblewrap) so every rollout is containerised. The harness itself is
transport-agnostic: anything satisfying `ModelClient` (an HTTP call, a
local vLLM engine, a policy under training) plugs in.

No third-party dependencies. Python >= 3.10.
"""

from __future__ import annotations

import concurrent.futures
import dataclasses
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Protocol

__all__ = [
    "ScaffoldState",
    "ExecutionRecord",
    "ModelClient",
    "ModelReply",
    "OpenAICompatClient",
    "SandboxConfig",
    "LocalSandbox",
    "PromptBuilder",
    "RefinementHook",
    "LoopDetector",
    "VerifierTamperedError",
    "OrnithHarness",
    "RolloutResult",
    "run_batch",
]

LOOP_ABORT_REASON = "loop_detected"
REFLECTION_CONTRACT_EXIT = 125
TIMEOUT_EXIT = 124

# --------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class ExecutionRecord:
    """Everything observed from one subprocess execution."""

    exit_code: int
    stdout: str
    stderr: str
    duration_s: float
    timed_out: bool

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out

    def failure_summary(self, max_chars: int = 8_000) -> str:
        """Compact failure text used as primary context for the next step."""
        parts = [f"exit_code={self.exit_code}", f"timed_out={self.timed_out}"]
        if self.stdout.strip():
            parts.append("--- stdout (tail) ---\n" + self.stdout[-max_chars:])
        if self.stderr.strip():
            # stderr carries the traceback — the most important signal.
            parts.append("--- stderr / traceback (tail) ---\n" + self.stderr[-max_chars:])
        return "\n".join(parts)


@dataclasses.dataclass(frozen=True)
class StepUsage:
    """Token usage for one harness step (summed over reflection retries)."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    model_calls: int = 0


@dataclasses.dataclass(frozen=True)
class ScaffoldState:
    """One completed harness iteration: the scaffold and its outcome."""

    iteration: int
    scaffold_code: str
    reflection: str | None
    record: ExecutionRecord
    scaffold_path: str
    state_dir: str
    verification: ExecutionRecord | None = None
    reward: float | None = None
    usage: StepUsage = dataclasses.field(default_factory=StepUsage)
    aborted_reason: str | None = None
    created_at: float = dataclasses.field(default_factory=time.time)

    @property
    def ok(self) -> bool:
        """Scaffold exited 0 AND (when a verifier is configured) passed it."""
        return self.record.ok and (self.verification is None or self.verification.ok)

    def to_json(self) -> str:
        return json.dumps(dataclasses.asdict(self), ensure_ascii=False)


# --------------------------------------------------------------------------
# Model transport (decoupled — bring any provider or a policy under training)
# --------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class ModelReply:
    """Optional richer return type for `ModelClient.complete` carrying usage."""

    text: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class ModelClient(Protocol):
    def complete(self, prompt: str) -> str | ModelReply:
        """Return the raw model output for `prompt` (the whole output is the
        scaffold; no tool-call envelope). Return `ModelReply` to feed token
        accounting; a bare `str` is also accepted."""
        ...


def _as_reply(raw: str | ModelReply) -> ModelReply:
    return raw if isinstance(raw, ModelReply) else ModelReply(text=raw)


class OpenAICompatClient:
    """ModelClient over any OpenAI-compatible /chat/completions endpoint.

    Covers Ollama (`http://host:11434/v1`), LM Studio, vLLM, llama.cpp
    server, OpenRouter and ZenMux with the same few lines. Standard library
    only. Retries transient network/5xx errors with exponential backoff.
    """

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        api_key: str | None = None,
        temperature: float = 1.0,
        max_tokens: int | None = None,
        timeout_s: float = 300.0,
        max_retries: int = 3,
        seed: int | None = None,
    ) -> None:
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.api_key = api_key
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout_s = timeout_s
        self.max_retries = max_retries
        self.seed = seed

    def complete(self, prompt: str) -> ModelReply:
        payload: dict[str, object] = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.temperature,
        }
        if self.max_tokens is not None:
            payload["max_tokens"] = self.max_tokens
        if self.seed is not None:
            payload["seed"] = self.seed
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        last_exc: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                req = urllib.request.Request(
                    self.url, data=json.dumps(payload).encode("utf-8"), headers=headers
                )
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                text = data["choices"][0]["message"]["content"] or ""
                usage = data.get("usage") or {}
                return ModelReply(
                    text=text,
                    prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"),
                )
            except urllib.error.HTTPError as exc:
                # 4xx is our bug (bad key/model) - retrying won't help.
                if exc.code < 500:
                    raise
                last_exc = exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
                last_exc = exc
            if attempt < self.max_retries:
                time.sleep(2**attempt)
        raise RuntimeError(f"model endpoint failed after {self.max_retries + 1} attempts: {last_exc}")


# --------------------------------------------------------------------------
# Sandbox
# --------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class SandboxConfig:
    timeout_s: float = 60.0
    cpu_seconds: int = 55
    memory_bytes: int = 1_024 * 1_024 * 1_024  # 1 GiB address space
    max_file_bytes: int = 64 * 1_024 * 1_024
    max_open_files: int = 256
    max_output_chars: int = 200_000
    # Extra env allowed through the scrubbed environment (e.g. PYTHONHASHSEED
    # for reproducible rollouts). Everything else is dropped.
    env_passthrough: tuple[str, ...] = ("PYTHONHASHSEED",)
    # Fixed extra env vars injected into every run (e.g. ("ORNITH_SEED","7")).
    extra_env: tuple[tuple[str, str], ...] = ()
    # Optional container wrapper; "{workdir}", "{state_dir}" and
    # "{script_dir}" (parent of the file being executed) are substituted.
    # When set, the rlimit preexec is skipped (the container runtime owns
    # the limits) and the container must provide a `python` on PATH.
    command_prefix: tuple[str, ...] = ()

    @staticmethod
    def docker_preset(
        image: str = "python:3.12-slim",
        *,
        memory: str = "1g",
        pids_limit: int = 256,
        timeout_s: float = 60.0,
    ) -> "SandboxConfig":
        """Containerised execution: no network, read-only root, all
        capabilities dropped; only the scratch CWD and STATE_DIR are
        writable. Host paths are mounted at identical container paths so
        the harness's path strings stay valid inside."""
        return SandboxConfig(
            timeout_s=timeout_s,
            command_prefix=(
                "docker", "run", "--rm", "--init",
                "--network=none",
                f"--memory={memory}",
                f"--pids-limit={pids_limit}",
                "--cap-drop=ALL",
                "--security-opt", "no-new-privileges",
                "--read-only",
                "-v", "{script_dir}:{script_dir}:ro",
                "-v", "{state_dir}:{state_dir}:rw",
                "-v", "{workdir}:{workdir}:rw",
                "-w", "{workdir}",
                "-e", "STATE_DIR={state_dir}",
                "-e", "PYTHONUNBUFFERED=1",
                image,
            ),
        )


class LocalSandbox:
    """Executes a scaffold file in an isolated child interpreter.

    Each execution gets a fresh scratch CWD; the persistent STATE_DIR is the
    only writable location carried across iterations, which is what lets a
    new scaffold RESUME (checkpoints, partial artifacts) instead of restart.
    """

    def __init__(self, config: SandboxConfig | None = None) -> None:
        self.config = config or SandboxConfig()

    def execute(self, script_path: Path, state_dir: Path) -> ExecutionRecord:
        cfg = self.config
        scratch = Path(tempfile.mkdtemp(prefix="ornith-run-"))
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(scratch),
            "TMPDIR": str(scratch),
            "STATE_DIR": str(state_dir),
            "PYTHONUNBUFFERED": "1",
        }
        for key in cfg.env_passthrough:
            if key in os.environ:
                env[key] = os.environ[key]
        env.update(dict(cfg.extra_env))

        subs = {
            "workdir": str(scratch),
            "state_dir": str(state_dir),
            "script_dir": str(script_path.parent),
        }
        if cfg.command_prefix:
            prefix = [p.format(**subs) for p in cfg.command_prefix]
            argv = [*prefix, "python", "-I", str(script_path)]
            preexec = None
        else:
            argv = [sys.executable, "-I", str(script_path)]
            preexec = self._make_rlimit_preexec() if os.name == "posix" else None

        start = time.monotonic()
        timed_out = False
        try:
            proc = subprocess.run(
                argv,
                cwd=scratch,
                env=env,
                capture_output=True,
                text=True,
                errors="replace",
                timeout=cfg.timeout_s,
                preexec_fn=preexec,  # noqa: PLW1509 - single subprocess spawn per call
                start_new_session=True,
            )
            exit_code, stdout, stderr = proc.returncode, proc.stdout, proc.stderr
        except subprocess.TimeoutExpired as exc:
            timed_out = True
            exit_code = TIMEOUT_EXIT
            stdout = _as_text(exc.stdout)
            stderr = _as_text(exc.stderr) + f"\n[harness] wall-clock timeout after {cfg.timeout_s}s"
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

        return ExecutionRecord(
            exit_code=exit_code,
            stdout=stdout[-cfg.max_output_chars :],
            stderr=stderr[-cfg.max_output_chars :],
            duration_s=time.monotonic() - start,
            timed_out=timed_out,
        )

    def _make_rlimit_preexec(self):  # type: ignore[no-untyped-def]
        import resource

        cfg = self.config

        def _limits() -> None:
            resource.setrlimit(resource.RLIMIT_CPU, (cfg.cpu_seconds, cfg.cpu_seconds))
            resource.setrlimit(resource.RLIMIT_AS, (cfg.memory_bytes, cfg.memory_bytes))
            resource.setrlimit(resource.RLIMIT_FSIZE, (cfg.max_file_bytes, cfg.max_file_bytes))
            resource.setrlimit(resource.RLIMIT_NOFILE, (cfg.max_open_files, cfg.max_open_files))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

        return _limits


def _as_text(raw: str | bytes | None) -> str:
    if raw is None:
        return ""
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return raw


# --------------------------------------------------------------------------
# Prompting + Refinement Hook
# --------------------------------------------------------------------------

_REFLECTION_RE = re.compile(r"<reflection>(.*?)</reflection>", re.DOTALL)
_FENCE_RE = re.compile(r"\A\s*```(?:python)?\s*\n(.*)\n```\s*\Z", re.DOTALL)


class PromptBuilder:
    """Builds the next-step prompt. The previous execution record is the
    PRIMARY context block; the task statement follows it."""

    HEADER = (
        "You are a control-scaffold agent. Your ENTIRE reply is written to a "
        "file and executed as Python — output ONLY Python source, no prose, "
        "no markdown fences, no JSON/XML tool tags.\n"
        "Persistent state lives in the directory given by the STATE_DIR "
        "environment variable; it survives across iterations. Checkpoint your "
        "progress there and, on re-entry, load the checkpoint and RESUME — "
        "never redo completed work.\n"
        "Exit with code 0 only when the task is fully complete."
    )

    REFLECTION_RULE = (
        "The previous scaffold FAILED. Before the code, you MUST include a "
        "block of the exact form:\n<reflection>\nwhy the previous scaffold "
        "failed, in 1-5 sentences, referencing the traceback\n</reflection>\n"
        "The harness strips this block; everything after it must be valid "
        "Python that FIXES the specific error below and resumes from the "
        "checkpointed state. Do not restart the task."
    )

    def build(
        self,
        task: str,
        last_state: ScaffoldState | None,
        notes: Sequence[str] = (),
    ) -> str:
        sections: list[str] = [self.HEADER]
        if last_state is not None and not last_state.ok:
            sections.append(self.REFLECTION_RULE)
            if last_state.record.ok and last_state.verification is not None:
                # Reward-hacking guard tripped: exited 0 but verification failed.
                sections.append(
                    "=== VERIFIER REJECTED (iteration "
                    f"{last_state.iteration}) ===\nYour scaffold exited 0 but "
                    "the held-out verifier rejected the result. Exiting 0 "
                    "without completing the task is always detected; do the "
                    "actual work.\n" + last_state.verification.failure_summary()
                )
            else:
                sections.append(
                    "=== PREVIOUS EXECUTION (iteration "
                    f"{last_state.iteration}) ===\n{last_state.record.failure_summary()}"
                )
            sections.append("=== PREVIOUS SCAFFOLD SOURCE ===\n" + last_state.scaffold_code)
        elif last_state is not None:
            sections.append(
                "=== PREVIOUS EXECUTION (iteration "
                f"{last_state.iteration}, succeeded) ===\n--- stdout (tail) ---\n"
                + last_state.record.stdout[-4_000:]
            )
        for note in notes:
            sections.append("=== HARNESS NOTE ===\n" + note)
        sections.append("=== TASK ===\n" + task)
        return "\n\n".join(sections)


class RefinementHook:
    """Enforces the self-reflection contract on raw model output."""

    def split(self, raw_output: str, *, reflection_required: bool) -> tuple[str | None, str]:
        """Return (reflection, scaffold_code).

        Raises ValueError when a required reflection is missing — the
        harness catches that and re-prompts rather than executing.
        """
        match = _REFLECTION_RE.search(raw_output)
        reflection = match.group(1).strip() if match else None
        if reflection_required and reflection is None:
            raise ValueError("missing required <reflection> block")
        code = _REFLECTION_RE.sub("", raw_output)
        fence = _FENCE_RE.match(code)  # defensively unwrap a single full fence
        if fence:
            code = fence.group(1)
        return reflection, code.strip() + "\n"


# --------------------------------------------------------------------------
# Loop detection
# --------------------------------------------------------------------------

_DIGITS_RE = re.compile(r"\d+")


class LoopDetector:
    """Detects a rollout that is stuck repeating itself.

    Two signals, both tracked only for FAILED steps:
      - failure signature: the terminal stderr line with digits collapsed
        (line numbers / addresses / temp names vary run-to-run);
      - scaffold fingerprint: whitespace-normalized hash of the code.

    First repeat -> an escalating harness note is injected into the next
    prompt. At `max_repeats` sightings of the same signature the rollout is
    aborted so a stuck policy stops burning tokens.
    """

    def __init__(self, max_repeats: int = 3) -> None:
        self.max_repeats = max_repeats
        self._sig_counts: dict[str, int] = {}
        self._code_counts: dict[str, int] = {}

    def observe(self, code: str, record: ExecutionRecord) -> tuple[str | None, bool]:
        """Register a completed step; return (note_for_next_prompt, abort)."""
        if record.ok:
            return None, False
        sig = self._failure_signature(record)
        code_fp = hashlib.sha256(" ".join(code.split()).encode()).hexdigest()
        sig_n = self._sig_counts[sig] = self._sig_counts.get(sig, 0) + 1
        code_n = self._code_counts[code_fp] = self._code_counts.get(code_fp, 0) + 1

        if sig_n >= self.max_repeats:
            return None, True
        notes: list[str] = []
        if sig_n > 1:
            notes.append(
                f"You have now hit this exact failure {sig_n} times: {sig!r}. "
                "Your previous fix did not address the root cause - take a "
                "genuinely different approach, do not resubmit a variation "
                "of the same scaffold."
            )
        if code_n > 1:
            notes.append(
                "You resubmitted a scaffold essentially identical to one "
                "that already failed. Identical code produces identical "
                "failures; change the approach."
            )
        return (" ".join(notes) or None), False

    @staticmethod
    def _failure_signature(record: ExecutionRecord) -> str:
        lines = [ln.strip() for ln in record.stderr.strip().splitlines() if ln.strip()]
        terminal = lines[-1] if lines else f"exit={record.exit_code}"
        return _DIGITS_RE.sub("N", terminal)[:300]


# --------------------------------------------------------------------------
# Harness
# --------------------------------------------------------------------------


class VerifierTamperedError(RuntimeError):
    """The held-out verifier script changed after harness construction."""


class OrnithHarness:
    """Recursive scaffold loop: generate -> execute -> inject failure -> repair.

    Every iteration is appended to `trajectory.jsonl` under `run_dir`
    (prompt, reflection, code, execution record, verification, reward,
    token usage) so an RL trainer can consume complete rollouts without
    extra instrumentation.

    `verifier_path`, when given, points at a harness-owned Python script
    (NEVER model-authored) executed in the sandbox after any scaffold that
    exits 0. It sees the same STATE_DIR; exit 0 means pass, and its last
    stdout line is parsed as the float reward (defaulting to 1.0 on pass /
    0.0 on reject). Success of a step then requires BOTH exits to be 0.
    """

    def __init__(
        self,
        model: ModelClient,
        task: str,
        *,
        sandbox: LocalSandbox | None = None,
        prompt_builder: PromptBuilder | None = None,
        refinement: RefinementHook | None = None,
        loop_detector: LoopDetector | None = None,
        verifier_path: str | os.PathLike[str] | None = None,
        run_dir: str | os.PathLike[str] | None = None,
        max_reflection_retries: int = 2,
    ) -> None:
        self.model = model
        self.task = task
        self.sandbox = sandbox or LocalSandbox()
        self.prompts = prompt_builder or PromptBuilder()
        self.refinement = refinement or RefinementHook()
        self.loop_detector = loop_detector or LoopDetector()
        self.max_reflection_retries = max_reflection_retries

        self.run_dir = Path(run_dir) if run_dir else Path(tempfile.mkdtemp(prefix="ornith-"))
        self.state_dir = self.run_dir / "state"
        self.scaffold_dir = self.run_dir / "scaffolds"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.scaffold_dir.mkdir(parents=True, exist_ok=True)
        self._trajectory = self.run_dir / "trajectory.jsonl"
        self._iteration = 0
        self._pending_note: str | None = None

        self.total_prompt_tokens = 0
        self.total_completion_tokens = 0

        self.verifier_path = Path(verifier_path) if verifier_path else None
        self._verifier_digest = self._hash_verifier() if self.verifier_path else None

    # -- core step ----------------------------------------------------------

    def run_recursive_step(self, last_state: ScaffoldState | None) -> ScaffoldState:
        """One recursion: prompt with the last execution state, enforce the
        reflection contract, execute the new scaffold in the sandbox, verify
        and score it, and return the resulting state (which becomes the next
        step's input)."""
        self._iteration += 1
        reflection_required = last_state is not None and not last_state.ok

        base_notes: list[str] = []
        if self._pending_note:
            base_notes.append(self._pending_note)
            self._pending_note = None

        usage_prompt = usage_completion = calls = 0
        retry_note: str | None = None
        reflection: str | None = None
        code = ""
        prompt = ""
        for attempt in range(self.max_reflection_retries + 1):
            notes = [*base_notes, retry_note] if retry_note else base_notes
            prompt = self.prompts.build(self.task, last_state, notes)
            reply = _as_reply(self.model.complete(prompt))
            calls += 1
            usage_prompt += reply.prompt_tokens or 0
            usage_completion += reply.completion_tokens or 0
            self.total_prompt_tokens += reply.prompt_tokens or 0
            self.total_completion_tokens += reply.completion_tokens or 0
            try:
                reflection, code = self.refinement.split(reply.text, reflection_required=reflection_required)
                break
            except ValueError:
                retry_note = (
                    "Your previous reply omitted the mandatory <reflection> block. "
                    "Reply again: <reflection>...</reflection> first, then the corrected scaffold."
                )
                if attempt == self.max_reflection_retries:
                    # Fail-closed: never execute an output that dodged the hook.
                    record = ExecutionRecord(
                        exit_code=REFLECTION_CONTRACT_EXIT,
                        stdout="",
                        stderr="[harness] model failed the reflection contract; scaffold not executed",
                        duration_s=0.0,
                        timed_out=False,
                    )
                    state = ScaffoldState(
                        iteration=self._iteration,
                        scaffold_code=reply.text,
                        reflection=None,
                        record=record,
                        scaffold_path="",
                        state_dir=str(self.state_dir),
                        usage=StepUsage(usage_prompt, usage_completion, calls),
                    )
                    self._log(prompt, state)
                    return state

        scaffold_path = self.scaffold_dir / f"scaffold_{self._iteration:04d}_{uuid.uuid4().hex[:8]}.py"
        scaffold_path.write_text(code, encoding="utf-8")

        record = self.sandbox.execute(scaffold_path, self.state_dir)

        verification: ExecutionRecord | None = None
        reward: float | None = None
        if record.ok and self.verifier_path is not None:
            verification = self._run_verifier()
            reward = self._parse_reward(verification)
        elif self.verifier_path is not None:
            reward = 0.0

        state = ScaffoldState(
            iteration=self._iteration,
            scaffold_code=code,
            reflection=reflection,
            record=record,
            scaffold_path=str(scaffold_path),
            state_dir=str(self.state_dir),
            verification=verification,
            reward=reward,
            usage=StepUsage(usage_prompt, usage_completion, calls),
        )

        # Loop detection considers the VERIFIED outcome: a scaffold that
        # exits 0 but keeps getting rejected is as stuck as one that crashes.
        effective = verification if (record.ok and verification is not None) else record
        note, abort = self.loop_detector.observe(code, effective)
        if abort:
            state = dataclasses.replace(
                state,
                aborted_reason=f"{LOOP_ABORT_REASON}: same failure repeated "
                f"{self.loop_detector.max_repeats} times",
            )
        elif note:
            self._pending_note = note

        self._log(prompt, state)
        return state

    # -- driver -------------------------------------------------------------

    def run(self, max_iterations: int = 8) -> ScaffoldState:
        """Recurse until a scaffold succeeds (exit 0 + verifier pass), the
        loop detector aborts, or the budget is exhausted."""
        state: ScaffoldState | None = None
        for _ in range(max_iterations):
            state = self.run_recursive_step(state)
            if state.ok or state.aborted_reason:
                return state
        assert state is not None
        return state

    # -- internals ----------------------------------------------------------

    def _hash_verifier(self) -> str:
        assert self.verifier_path is not None
        return hashlib.sha256(self.verifier_path.read_bytes()).hexdigest()

    def _run_verifier(self) -> ExecutionRecord:
        if self._hash_verifier() != self._verifier_digest:
            raise VerifierTamperedError(
                f"verifier {self.verifier_path} changed since harness construction - "
                "treat this rollout as compromised"
            )
        assert self.verifier_path is not None
        return self.sandbox.execute(self.verifier_path, self.state_dir)

    @staticmethod
    def _parse_reward(verification: ExecutionRecord) -> float:
        if not verification.ok:
            return 0.0
        lines = [ln.strip() for ln in verification.stdout.strip().splitlines() if ln.strip()]
        if lines:
            try:
                return float(lines[-1])
            except ValueError:
                pass
        return 1.0

    def _log(self, prompt: str, state: ScaffoldState) -> None:
        entry = {
            "prompt": prompt,
            **dataclasses.asdict(state),
            "totals": {
                "prompt_tokens": self.total_prompt_tokens,
                "completion_tokens": self.total_completion_tokens,
            },
        }
        with self._trajectory.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------
# Batch rollouts
# --------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class RolloutResult:
    rollout_id: int
    run_dir: str
    ok: bool
    aborted_reason: str | None
    iterations: int
    reward: float | None
    prompt_tokens: int
    completion_tokens: int


def run_batch(
    model_factory: Callable[[int], ModelClient],
    task: str,
    *,
    n_rollouts: int,
    run_root: str | os.PathLike[str],
    verifier_path: str | os.PathLike[str] | None = None,
    sandbox_config: SandboxConfig | None = None,
    max_iterations: int = 8,
    max_workers: int = 4,
) -> list[RolloutResult]:
    """Run `n_rollouts` independent rollouts of `task` in parallel threads.

    Threads (not processes) because rollout time is spent in subprocesses
    and model I/O, and model clients are rarely picklable. Each rollout
    gets its own run directory (`rollout_0000`, ...) with its own
    `trajectory.jsonl` and `summary.json`, a `ModelClient` built by
    `model_factory(rollout_id)` (seed your sampler with the id for
    reproducibility), and ORNITH_SEED=<id> in its sandbox env.

    RESUMABLE: a rollout directory that already contains `summary.json` is
    loaded from disk instead of re-run, so re-issuing the same command after
    a crash or Ctrl-C only fills in the missing rollouts.
    """
    root = Path(run_root)
    root.mkdir(parents=True, exist_ok=True)

    def _one(rollout_id: int) -> RolloutResult:
        summary_path = root / f"rollout_{rollout_id:04d}" / "summary.json"
        if summary_path.exists():
            return RolloutResult(**json.loads(summary_path.read_text(encoding="utf-8")))
        base_cfg = sandbox_config or SandboxConfig()
        cfg = dataclasses.replace(
            base_cfg,
            extra_env=(*base_cfg.extra_env, ("ORNITH_SEED", str(rollout_id))),
        )
        harness = OrnithHarness(
            model_factory(rollout_id),
            task,
            sandbox=LocalSandbox(cfg),
            verifier_path=verifier_path,
            run_dir=root / f"rollout_{rollout_id:04d}",
        )
        final = harness.run(max_iterations=max_iterations)
        result = RolloutResult(
            rollout_id=rollout_id,
            run_dir=str(harness.run_dir),
            ok=final.ok,
            aborted_reason=final.aborted_reason,
            iterations=final.iteration,
            reward=final.reward,
            prompt_tokens=harness.total_prompt_tokens,
            completion_tokens=harness.total_completion_tokens,
        )
        (harness.run_dir / "summary.json").write_text(
            json.dumps(dataclasses.asdict(result), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        return list(pool.map(_one, range(n_rollouts)))


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """Run rollouts from the terminal.

    Example (Ollama box):
        python ornith_harness.py \\
            --task "Write a CSV report of ..." \\
            --model-url http://localhost:11434/v1 --model qwen2.5-coder:14b \\
            --verifier verifier.py --rollouts 8 --run-dir ./runs/exp1
    """
    import argparse

    p = argparse.ArgumentParser(prog="ornith_harness", description=main.__doc__)
    task_g = p.add_mutually_exclusive_group(required=True)
    task_g.add_argument("--task", help="task text")
    task_g.add_argument("--task-file", help="file containing the task text")
    p.add_argument("--model-url", required=True, help="OpenAI-compatible base URL (ends in /v1)")
    p.add_argument("--model", required=True, help="model name at that endpoint")
    p.add_argument("--api-key", default=os.environ.get("ORNITH_API_KEY"), help="or set ORNITH_API_KEY")
    p.add_argument("--verifier", help="path to the held-out verifier script")
    p.add_argument("--rollouts", type=int, default=1)
    p.add_argument("--max-iterations", type=int, default=8)
    p.add_argument("--max-workers", type=int, default=4)
    p.add_argument("--run-dir", help="output root (default: temp dir, printed)")
    p.add_argument("--temperature", type=float, default=1.0)
    p.add_argument("--scaffold-timeout", type=float, default=60.0, help="seconds per scaffold run")
    p.add_argument("--docker-image", help="containerise runs, e.g. python:3.12-slim (needs docker)")
    args = p.parse_args(argv)

    task = args.task if args.task else Path(args.task_file).read_text(encoding="utf-8")
    run_root = Path(args.run_dir) if args.run_dir else Path(tempfile.mkdtemp(prefix="ornith-cli-"))

    if args.docker_image:
        cfg = SandboxConfig.docker_preset(args.docker_image, timeout_s=args.scaffold_timeout)
    else:
        cfg = SandboxConfig(timeout_s=args.scaffold_timeout)

    def factory(rollout_id: int) -> ModelClient:
        return OpenAICompatClient(
            args.model_url,
            args.model,
            api_key=args.api_key,
            temperature=args.temperature,
            seed=rollout_id,
        )

    if args.rollouts == 1:
        harness = OrnithHarness(
            factory(0), task,
            sandbox=LocalSandbox(cfg),
            verifier_path=args.verifier,
            run_dir=run_root,
        )
        final = harness.run(max_iterations=args.max_iterations)
        print(f"run dir:    {harness.run_dir}")
        print(f"iterations: {final.iteration}")
        print(f"ok:         {final.ok}" + (f"  (aborted: {final.aborted_reason})" if final.aborted_reason else ""))
        if final.reward is not None:
            print(f"reward:     {final.reward}")
        print(f"tokens:     {harness.total_prompt_tokens} in / {harness.total_completion_tokens} out")
        return 0 if final.ok else 1

    results = run_batch(
        factory, task,
        n_rollouts=args.rollouts,
        run_root=run_root,
        verifier_path=args.verifier,
        sandbox_config=cfg,
        max_iterations=args.max_iterations,
        max_workers=args.max_workers,
    )
    ok_n = sum(r.ok for r in results)
    tok_in = sum(r.prompt_tokens for r in results)
    tok_out = sum(r.completion_tokens for r in results)
    print(f"run root: {run_root}")
    for r in results:
        status = "ok" if r.ok else (r.aborted_reason or "failed")
        reward = "-" if r.reward is None else f"{r.reward:g}"
        print(f"  rollout {r.rollout_id:04d}: {status:>12}  iters={r.iterations}  reward={reward}")
    print(f"passed {ok_n}/{len(results)}; tokens {tok_in} in / {tok_out} out")
    return 0 if ok_n == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
