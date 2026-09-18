import { randomUUID } from "node:crypto";

import { clampRiskScore } from "@/lib/config";
import type {
  AgentEvent,
  EventType,
  RiskLevel,
  SecurityAssessment,
  SourceType,
} from "@/types/events";

export interface CreateAgentEventInput {
  readonly id?: string;
  readonly runId: string;
  readonly timestamp?: string;
  readonly eventType: EventType;
  readonly sourceType: SourceType;
  readonly sourceId: string;
  readonly destinationId?: string;
  readonly parentEventId?: string;
  readonly rootEventId?: string;
  readonly content: string;
  readonly riskScore?: number;
  readonly flags?: readonly string[];
  readonly influencedBy?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Object.freeze(
    values.filter(
      (value, index) =>
        typeof value === "string" &&
        value.length > 0 &&
        values.indexOf(value) === index,
    ),
  );
}

function freezeMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!metadata) return undefined;
  const cloneValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => cloneValue(item)));
    }
    if (value && typeof value === "object") {
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
        ),
      );
    }
    return value;
  };
  return cloneValue(metadata) as Readonly<Record<string, unknown>>;
}

export function riskLevelForScore(score: number): RiskLevel {
  const normalized = clampRiskScore(score);
  if (normalized >= 90) return "critical";
  if (normalized >= 60) return "high";
  if (normalized >= 30) return "medium";
  return "low";
}

/**
 * Creates a deeply immutable-enough event record for append-only storage.
 * The event ID becomes the root ID when no prior root is supplied.
 */
export function createAgentEvent(input: CreateAgentEventInput): AgentEvent {
  const id = input.id ?? randomUUID();
  const riskScore = clampRiskScore(input.riskScore ?? 0);
  const event: AgentEvent = {
    id,
    runId: input.runId,
    timestamp: input.timestamp ?? new Date().toISOString(),
    eventType: input.eventType,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    ...(input.destinationId
      ? { destinationId: input.destinationId }
      : {}),
    ...(input.parentEventId
      ? { parentEventId: input.parentEventId }
      : {}),
    rootEventId: input.rootEventId ?? id,
    content: input.content,
    riskScore,
    riskLevel: riskLevelForScore(riskScore),
    flags: uniqueStrings(input.flags ?? []),
    influencedBy: uniqueStrings(input.influencedBy ?? []),
    ...(input.metadata ? { metadata: freezeMetadata(input.metadata) } : {}),
  };

  return Object.freeze(event);
}

/** Returns a new immutable record; the prior event is never modified. */
export function applySecurityAssessment(
  event: AgentEvent,
  assessment: SecurityAssessment,
): AgentEvent {
  const riskScore = clampRiskScore(
    Math.max(event.riskScore, assessment.riskScore),
  );
  const ruleEvidence = assessment.ruleEvidence ?? [];
  const rawRuleScore = ruleEvidence.reduce((total, item) => total + item.weight, 0);
  return Object.freeze({
    ...event,
    riskScore,
    riskLevel: riskLevelForScore(riskScore),
    flags: uniqueStrings([...event.flags, ...assessment.flags]),
    metadata: freezeMetadata({
      ...(event.metadata ?? {}),
      securityClassification: assessment.classification,
      securityReason: assessment.reason,
      securityAssessmentSource: assessment.source,
      securityRuleEvidence: ruleEvidence,
      securityRuleRawScore: rawRuleScore,
      securityDeterministicScore: clampRiskScore(rawRuleScore),
    }),
  });
}

/** Adds exposure without ever reducing the deterministic assessment. */
export function applyContextExposure(
  event: AgentEvent,
  context: readonly AgentEvent[],
): AgentEvent {
  const exposure = context.reduce(
    (highest, candidate) => Math.max(highest, candidate.riskScore),
    0,
  );
  if (exposure <= event.riskScore) return event;

  const exposedBy = context
    .filter((candidate) => candidate.riskScore === exposure)
    .map((candidate) => candidate.id);
  const nextFlags = [
    ...event.flags,
    "context_exposure",
    "potentially_influenced",
    ...(exposure >= 60 ? ["high_risk_context"] : []),
  ];

  return Object.freeze({
    ...event,
    riskScore: exposure,
    riskLevel: riskLevelForScore(exposure),
    flags: uniqueStrings(nextFlags),
    metadata: freezeMetadata({
      ...(event.metadata ?? {}),
      agentExposure: exposure,
      exposedBy,
    }),
  });
}

export function orderedUniqueEventIds(
  events: readonly AgentEvent[],
): readonly string[] {
  return uniqueStrings(events.map((event) => event.id));
}
