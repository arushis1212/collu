import assert from "node:assert/strict";
import test from "node:test";

import { RISK_BLOCK_THRESHOLD } from "@/lib/config";
import {
  applyContextExposure,
  applySecurityAssessment,
  createAgentEvent,
  orderedUniqueEventIds,
  riskLevelForScore,
} from "@/lib/events";
import type { AgentEvent, SecurityAssessment } from "@/types/events";

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return createAgentEvent({
    id: "event-1",
    runId: "run-1",
    timestamp: "2026-09-18T12:00:00.000Z",
    eventType: "agent_message",
    sourceType: "agent",
    sourceId: "research",
    destinationId: "analysis",
    content: "Evidence is ready for analysis.",
    ...overrides,
  });
}

test("events preserve explicit causal fields and are immutable", () => {
  const root = createAgentEvent({
    id: "root",
    runId: "run-1",
    timestamp: "2026-09-18T12:00:00.000Z",
    eventType: "user_input",
    sourceType: "human",
    sourceId: "human",
    destinationId: "coordinator",
    content: "Summarize the sandbox evidence.",
    metadata: { channel: "demo" },
  });
  const child = makeEvent({
    id: "child",
    parentEventId: root.id,
    rootEventId: root.id,
    influencedBy: [root.id, root.id, "context-2"],
    flags: ["observed", "observed"],
  });

  assert.equal(root.rootEventId, root.id);
  assert.equal(child.parentEventId, root.id);
  assert.equal(child.rootEventId, root.id);
  assert.deepEqual(child.influencedBy, [root.id, "context-2"]);
  assert.deepEqual(child.flags, ["observed"]);
  assert.ok(Object.isFrozen(root));
  assert.ok(Object.isFrozen(root.flags));
  assert.ok(Object.isFrozen(root.influencedBy));
  assert.ok(Object.isFrozen(root.metadata));
});

test("security assessment returns a new event and cannot lower prior risk", () => {
  const original = makeEvent({ riskScore: 84, flags: ["deterministic_rule"] });
  const assessment: SecurityAssessment = {
    riskScore: 20,
    classification: "benign",
    flags: ["judge_checked"],
    reason: "The advisory judge did not add risk.",
    shouldEscalate: false,
    source: "judge",
    ruleEvidence: [{ flag: "deterministic_rule", weight: 84 }],
  };

  const assessed = applySecurityAssessment(original, assessment);

  assert.notEqual(assessed, original);
  assert.equal(original.riskScore, 84);
  assert.deepEqual(original.flags, ["deterministic_rule"]);
  assert.equal(assessed.riskScore, 84);
  assert.deepEqual(assessed.flags, ["deterministic_rule", "judge_checked"]);
  assert.equal(assessed.metadata?.securityClassification, "benign");
  assert.equal(assessed.metadata?.securityRuleRawScore, 84);
  assert.equal(assessed.metadata?.securityDeterministicScore, 84);
  assert.deepEqual(assessed.metadata?.securityRuleEvidence, [
    { flag: "deterministic_rule", weight: 84 },
  ]);
  assert.ok(Object.isFrozen(assessed));
});

test("risk levels and the protected boundary are deterministic", () => {
  assert.equal(riskLevelForScore(-1), "low");
  assert.equal(riskLevelForScore(29), "low");
  assert.equal(riskLevelForScore(30), "medium");
  assert.equal(riskLevelForScore(59), "medium");
  assert.equal(riskLevelForScore(60), "high");
  assert.equal(riskLevelForScore(79), "high");
  assert.equal(riskLevelForScore(80), "high");
  assert.equal(riskLevelForScore(90), "critical");
  assert.equal(riskLevelForScore(101), "critical");
  assert.equal(RISK_BLOCK_THRESHOLD, 80);
  assert.equal(79 >= RISK_BLOCK_THRESHOLD, false);
  assert.equal(80 >= RISK_BLOCK_THRESHOLD, true);
});

test("context exposure is the maximum context risk and records its source", () => {
  const clean = makeEvent({ id: "clean", riskScore: 3 });
  const medium = makeEvent({ id: "medium", riskScore: 48 });
  const risky = makeEvent({ id: "risky", riskScore: 92 });
  const output = makeEvent({ id: "output", riskScore: 5 });

  const exposed = applyContextExposure(output, [clean, medium, risky]);

  assert.equal(exposed.riskScore, 92);
  assert.equal(exposed.riskLevel, "critical");
  assert.deepEqual(exposed.metadata?.exposedBy, ["risky"]);
  assert.ok(exposed.flags.includes("high_risk_context"));
  assert.ok(exposed.flags.includes("potentially_influenced"));
  assert.deepEqual(orderedUniqueEventIds([clean, medium, clean, risky]), [
    "clean",
    "medium",
    "risky",
  ]);
});
