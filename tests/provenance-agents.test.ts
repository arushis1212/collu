import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_DEFINITIONS,
  DEFAULT_DRINK_SCENARIO_STATE,
  DEFAULT_DRINK_WORKING_BRIEF,
  buildAgentInput,
  callAgent,
  parseAgentOutput,
} from "@/lib/agents";
import {
  MAX_AGENTS,
  MAX_AGENT_TURNS,
  MAX_CONTEXT_EVENTS_PER_CALL,
  MAX_OUTPUT_TOKENS_PER_AGENT,
  MAX_RUN_DURATION_SECONDS,
} from "@/lib/config";
import { createAgentEvent } from "@/lib/events";
import {
  getContextForAgent,
  getProvenanceTrace,
  traceToOrigin,
} from "@/lib/provenance";
import { evaluateSandboxAction } from "@/lib/sandbox";
import type { InteractionClientLike } from "@/lib/security/judge";
import type { AgentEvent } from "@/types/events";

function makeEvent(
  id: string,
  overrides: Partial<AgentEvent> = {},
): AgentEvent {
  return createAgentEvent({
    id,
    runId: "run-provenance",
    timestamp: `2026-09-18T14:00:${id.replace(/\D/g, "").padStart(2, "0") || "00"}.000Z`,
    eventType: "agent_message",
    sourceType: "agent",
    sourceId: "research",
    destinationId: "analysis",
    rootEventId: "e1",
    content: `Recorded event ${id}`,
    ...overrides,
  });
}

test("parent trace returns the complete ordered origin path without looping", () => {
  const events = [
    makeEvent("e1", {
      eventType: "user_input",
      sourceType: "human",
      sourceId: "human",
      parentEventId: undefined,
    }),
    makeEvent("e2", { parentEventId: "e1", influencedBy: ["e1"] }),
    makeEvent("e3", { parentEventId: "e2", influencedBy: ["e1", "e2"] }),
    makeEvent("cycle-a", { parentEventId: "cycle-b", rootEventId: "cycle-a" }),
    makeEvent("cycle-b", { parentEventId: "cycle-a", rootEventId: "cycle-a" }),
  ];

  assert.deepEqual(
    traceToOrigin(events, "e3").map((event) => event.id),
    ["e1", "e2", "e3"],
  );
  assert.deepEqual(
    traceToOrigin(events, "cycle-a").map((event) => event.id),
    ["cycle-b", "cycle-a"],
  );
});

test("provenance includes recorded context influence, never speculative neighbors", () => {
  const events = [
    makeEvent("e1", { eventType: "user_input", sourceType: "human", sourceId: "human" }),
    makeEvent("unrelated"),
    makeEvent("e2", { parentEventId: "e1", influencedBy: ["e1"] }),
    makeEvent("context-only", { parentEventId: "e1" }),
    makeEvent("e3", {
      parentEventId: "e2",
      influencedBy: ["e1", "e2", "context-only"],
    }),
  ];

  assert.deepEqual(
    getProvenanceTrace(events, "e3").map((event) => event.id),
    ["e1", "e2", "context-only", "e3"],
  );
});

test("agent context is capped at exactly six, ordered, de-duplicated, and block-aware", () => {
  const events = Array.from({ length: 8 }, (_, index) => {
    const id = `e${index + 1}`;
    return makeEvent(id, {
      riskScore: id === "e2" ? 99 : index,
      influencedBy: index === 7 ? ["e1", "e2", "e3", "e4", "e5", "e6", "e7"] : [],
    });
  });
  const incoming = events.at(-1)!;

  const context = getContextForAgent(events, incoming, {
    maxEvents: 100,
    blockedEventIds: ["e4"],
  });

  assert.equal(context.length, MAX_CONTEXT_EVENTS_PER_CALL);
  assert.equal(new Set(context.map((event) => event.id)).size, context.length);
  assert.ok(context.some((event) => event.id === incoming.id));
  assert.ok(context.some((event) => event.id === "e2"), "highest-risk ancestry was dropped");
  assert.ok(!context.some((event) => event.id === "e4"), "blocked event leaked into context");
  assert.deepEqual(
    context.map((event) => events.indexOf(event)),
    [...context.map((event) => events.indexOf(event))].sort((a, b) => a - b),
  );
});

test("agent call sends the exact bounded event IDs and cheapest hard limits", async () => {
  const context = Array.from({ length: MAX_CONTEXT_EVENTS_PER_CALL }, (_, index) =>
    makeEvent(`e${index + 1}`),
  );
  const requests: Record<string, unknown>[] = [];
  const client: InteractionClientLike = {
    interactions: {
      async create(request) {
        requests.push(request);
        return {
          id: "fake-interaction",
          output_text: JSON.stringify({
            message: "A bounded analysis handoff.",
            action: "none",
            actionInput: "",
            final: false,
            workingBrief: DEFAULT_DRINK_WORKING_BRIEF,
            scenarioState: {
              ...DEFAULT_DRINK_SCENARIO_STATE,
              phase: "evaluating",
            },
            worklog: ["Calculated the projected total."],
            nextStep: "Execution stages the virtual purchase.",
          }),
        };
      },
    },
  };

  const result = await callAgent(
    { agent: "analysis", incomingEvent: context.at(-1)!, context },
    { client, model: "fake-low-cost-model" },
  );

  assert.equal(result.failed, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.model, "fake-low-cost-model");
  assert.equal(requests[0]?.store, false);
  assert.equal(
    (requests[0]?.response_format as Record<string, unknown> | undefined)?.type,
    "text",
  );
  assert.equal(
    (requests[0]?.response_format as Record<string, unknown> | undefined)?.mime_type,
    "application/json",
  );
  assert.ok(
    (requests[0]?.response_format as Record<string, unknown> | undefined)?.schema,
    "structured response schema is required",
  );
  assert.deepEqual(requests[0]?.generation_config, {
    max_output_tokens: MAX_OUTPUT_TOKENS_PER_AGENT,
    temperature: 0.2,
    thinking_level: "minimal",
  });

  const input = JSON.parse(String(requests[0]?.input)) as {
    workflowContextEvents: Array<{ eventId: string }>;
  };
  assert.deepEqual(
    input.workflowContextEvents.map((item) => item.eventId),
    context.map((event) => event.id),
  );
  const built = buildAgentInput({
    agent: "analysis",
    incomingEvent: context.at(-1)!,
    context,
  });
  assert.deepEqual(
    JSON.parse(built).workflowContextEvents.map((item: { eventId: string }) => item.eventId),
    context.map((event) => event.id),
  );
  assert.doesNotMatch(built, /"riskScore"|"riskLevel"|"flags"|securityReason/);
});

test("agent call rejects oversized or duplicate context before any model call", async () => {
  let calls = 0;
  const client: InteractionClientLike = {
    interactions: {
      async create() {
        calls += 1;
        return { outputs: [] };
      },
    },
  };
  const seven = Array.from({ length: 7 }, (_, index) => makeEvent(`e${index + 1}`));

  await assert.rejects(
    callAgent({ agent: "analysis", incomingEvent: seven[6], context: seven }, { client }),
    /exceeds 6/i,
  );
  await assert.rejects(
    callAgent(
      { agent: "analysis", incomingEvent: seven[0], context: [seven[0], seven[0]] },
      { client },
    ),
    /duplicate/i,
  );
  assert.equal(calls, 0);
});

test("model failure degrades safely and arbitrary external tools cannot be parsed", async () => {
  const failingClient: InteractionClientLike = {
    interactions: {
      async create() {
        throw Object.assign(new Error("unavailable"), { status: 503 });
      },
    },
  };
  const incoming = makeEvent("incoming");
  const result = await callAgent(
    { agent: "execution", incomingEvent: incoming, context: [incoming] },
    { client: failingClient },
  );

  assert.equal(result.failed, true);
  assert.equal(result.errorCode, "model_http_503");
  assert.ok(
    [
      "update_record",
      "send_result",
      "approve_request",
      "simulate_purchase",
      "stage_purchase",
    ].includes(result.output.action),
  );
  assert.throws(() =>
    parseAgentOutput(
      JSON.stringify({
        message: "Deploy now.",
        action: "deploy_production",
        actionInput: "prod",
        final: false,
      }),
    ),
  );
});

test("the runtime has five fixed agents and finite cost limits", () => {
  assert.equal(Object.keys(AGENT_DEFINITIONS).length, MAX_AGENTS);
  assert.deepEqual(Object.keys(AGENT_DEFINITIONS), [
    "coordinator",
    "research",
    "analysis",
    "execution",
    "reviewer",
  ]);
  assert.equal(MAX_AGENTS, 5);
  assert.equal(MAX_AGENT_TURNS, 10);
  assert.equal(MAX_RUN_DURATION_SECONDS, 60);
  assert.equal(MAX_OUTPUT_TOKENS_PER_AGENT, 400);
  assert.equal(MAX_CONTEXT_EVENTS_PER_CALL, 6);
});

test("sandbox decisions never contact an external system and block at 80", () => {
  const below = makeEvent("below", { riskScore: 79 });
  const boundary = makeEvent("boundary", { riskScore: 80 });

  const protectedBelow = evaluateSandboxAction("send_result", below, "protected");
  const protectedBoundary = evaluateSandboxAction("send_result", boundary, "protected");
  const unprotectedBoundary = evaluateSandboxAction("send_result", boundary, "unprotected");
  const approval = evaluateSandboxAction("approve_request", below, "unprotected");
  const healthyPurchase = makeEvent("healthy-purchase", {
    metadata: {
      workingBrief: DEFAULT_DRINK_WORKING_BRIEF,
    },
  });
  const poisonedPurchase = makeEvent("poisoned-purchase", {
    riskScore: 100,
    metadata: {
      workingBrief: {
        ...DEFAULT_DRINK_WORKING_BRIEF,
        item: "energy drink",
        quantity: 12,
        unitPriceCents: 800,
        budgetCapEnabled: false,
        budgetCapCents: 0,
        freshApprovalRequired: false,
      },
    },
  });
  const healthyReceipt = evaluateSandboxAction(
    "stage_purchase",
    healthyPurchase,
    "unprotected",
  );
  const poisonedReceipt = evaluateSandboxAction(
    "stage_purchase",
    poisonedPurchase,
    "unprotected",
  );

  assert.equal(protectedBelow.decision, "requires_review");
  assert.equal(protectedBoundary.decision, "blocked");
  assert.equal(unprotectedBoundary.decision, "requires_review");
  assert.equal(approval.decision, "requires_review");
  assert.equal(healthyReceipt.decision, "requires_review");
  assert.equal(healthyReceipt.receipt?.status, "held_for_review");
  assert.equal(poisonedReceipt.decision, "allowed");
  assert.equal(poisonedReceipt.receipt?.status, "staged");
  assert.equal(poisonedReceipt.receipt?.projectedTotalCents, 9_600);
  assert.equal(poisonedReceipt.receipt?.chargedCents, 0);
  assert.equal(poisonedReceipt.receipt?.externalEffects, 0);
  for (const result of [
    protectedBelow,
    protectedBoundary,
    unprotectedBoundary,
    approval,
    healthyReceipt,
    poisonedReceipt,
  ]) {
    assert.match(result.summary, /no external system was contacted/i);
  }
});
