import assert from "node:assert/strict";
import test from "node:test";

import { signCheckpoint, verifyCheckpoint, type RunCheckpointState } from "@/lib/checkpoint";
import {
  MAX_AGENT_TURNS,
  MAX_INPUT_CHARACTERS,
  RUN_LIMITS,
} from "@/lib/config";
import { createAgentEvent } from "@/lib/events";
import { createNdjsonStream, encodeNdjson } from "@/lib/stream";
import { parseRunRequest, RequestValidationError } from "@/lib/validation";
import type { StreamEnvelope } from "@/types/events";

const runStarted: StreamEnvelope = {
  type: "run_started",
  runId: "run-protocol",
  phase: 1,
  mode: "protected",
  limits: RUN_LIMITS,
};

test("request validation accepts and normalizes both run phases", () => {
  assert.deepEqual(
    parseRunRequest({ action: "start", prompt: "  Review this  ", mode: "protected" }),
    { action: "start", prompt: "Review this", mode: "protected" },
  );
  assert.deepEqual(
    parseRunRequest({
      action: "continue",
      checkpoint: "signed-token",
      attack: {
        type: "agent_poisoning",
      },
    }),
    {
      action: "continue",
      checkpoint: "signed-token",
      attack: {
        type: "agent_poisoning",
      },
    },
  );
});

test("request validation rejects malformed, unbounded, or unknown control input", () => {
  const invalid: unknown[] = [
    null,
    [],
    {},
    { action: "start", prompt: "", mode: "protected" },
    { action: "start", prompt: "x", mode: "unsafe" },
    { action: "start", prompt: "x", mode: "protected", model: "client-selected-model" },
    { action: "start", prompt: "x", mode: "protected", limits: { maxAgentTurns: 1 } },
    { action: "start", prompt: "x", mode: "protected", unknown: true },
    { action: "start", prompt: "x".repeat(MAX_INPUT_CHARACTERS + 1), mode: "protected" },
    { action: "continue", checkpoint: "" },
    { action: "continue", checkpoint: "x".repeat(64_001) },
    {
      action: "continue",
      checkpoint: "signed-token",
      attack: { type: "unknown" },
    },
    {
      action: "continue",
      checkpoint: "signed-token",
      attack: { type: "agent_poisoning", targetAgent: "unbounded-new-agent" },
    },
    {
      action: "continue",
      checkpoint: "signed-token",
      attack: { type: "agent_poisoning", targetAgent: "research" },
    },
    {
      action: "continue",
      checkpoint: "signed-token",
      attack: { type: "agent_poisoning", payload: "custom attacker input" },
    },
    {
      action: "continue",
      checkpoint: "signed-token",
      attack: { type: "agent_poisoning", extra: true },
    },
    {
      action: "continue",
      checkpoint: "signed-token",
      model: "client-selected-model",
    },
  ];

  for (const value of invalid) {
    assert.throws(() => parseRunRequest(value), RequestValidationError);
  }
});

test("NDJSON encoder emits one complete record per line", () => {
  const text = new TextDecoder().decode(encodeNdjson(runStarted));
  assert.equal(text.endsWith("\n"), true);
  assert.equal(text.split("\n").length, 2);
  assert.deepEqual(JSON.parse(text.trim()), runStarted);
});

test("stream exposes envelopes incrementally in original order", async () => {
  const yielded: string[] = [];
  async function* source(): AsyncGenerator<StreamEnvelope> {
    yielded.push("first");
    yield runStarted;
    yielded.push("second");
    yield {
      type: "complete",
      runId: "run-protocol",
      phase: 1,
      status: "paused",
      eventCount: 0,
    };
  }

  const reader = createNdjsonStream(source()).getReader();
  assert.deepEqual(yielded, []);
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.deepEqual(yielded, ["first"]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(first.value).trim()), runStarted);

  const second = await reader.read();
  assert.equal(second.done, false);
  assert.deepEqual(yielded, ["first", "second"]);
  assert.equal(JSON.parse(new TextDecoder().decode(second.value).trim()).type, "complete");
  assert.equal((await reader.read()).done, true);
});

test("signed checkpoint round-trips but rejects tampering, expiry, and wrong secret", () => {
  const now = 2_000_000_000;
  const root = createAgentEvent({
    id: "checkpoint-root",
    runId: "run-checkpoint",
    timestamp: "2026-09-18T15:00:00.000Z",
    eventType: "user_input",
    sourceType: "human",
    sourceId: "human",
    destinationId: "coordinator",
    content: "Review this request.",
  });
  const state: RunCheckpointState = {
    version: 1,
    runId: "run-checkpoint",
    mode: "protected",
    phase: 1,
    events: [root],
    handoffEventId: root.id,
    blockedEventIds: [],
    agentTurns: 1,
    activeElapsedMs: 250,
    issuedAtEpochSeconds: now,
  };
  const token = signCheckpoint(state, "test-only-secret");
  const restored = verifyCheckpoint(token, "test-only-secret", now + 1);

  assert.equal(restored.runId, state.runId);
  assert.deepEqual(restored.events, state.events);
  assert.ok(Object.isFrozen(restored));
  assert.ok(Object.isFrozen(restored.events));
  assert.throws(() => verifyCheckpoint(`${token}x`, "test-only-secret", now + 1), /signature|malformed/i);
  assert.throws(() => verifyCheckpoint(token, "different-secret", now + 1), /signature/i);
  assert.throws(() => verifyCheckpoint(token, "test-only-secret", now + 901), /expired/i);
});

test("checkpoint cannot smuggle a run beyond the turn limit", () => {
  const root = createAgentEvent({
    id: "checkpoint-root",
    runId: "run-checkpoint",
    eventType: "user_input",
    sourceType: "human",
    sourceId: "human",
    content: "Review this request.",
  });
  const invalid = {
    version: 1,
    runId: "run-checkpoint",
    mode: "protected",
    phase: 1,
    events: [root],
    handoffEventId: root.id,
    blockedEventIds: [],
    agentTurns: MAX_AGENT_TURNS + 1,
    activeElapsedMs: 0,
    issuedAtEpochSeconds: 2_000_000_000,
  } as unknown as RunCheckpointState;
  const token = signCheckpoint(invalid, "test-only-secret");

  assert.throws(
    () => verifyCheckpoint(token, "test-only-secret", 2_000_000_000),
    /checkpoint state is invalid/i,
  );
});
