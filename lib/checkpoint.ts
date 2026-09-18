import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { CHECKPOINT_TTL_SECONDS, MAX_AGENT_TURNS } from "@/lib/config";
import { createAgentEvent } from "@/lib/events";
import type { AgentEvent, RunMode } from "@/types/events";

export interface RunCheckpointState {
  readonly version: 1;
  readonly runId: string;
  readonly mode: RunMode;
  readonly phase: 1;
  readonly events: readonly AgentEvent[];
  readonly handoffEventId: string;
  readonly blockedEventIds: readonly string[];
  readonly agentTurns: number;
  readonly activeElapsedMs: number;
  readonly issuedAtEpochSeconds: number;
}

const processFallbackSecret = randomBytes(32);

export function getCheckpointSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | Uint8Array {
  return (
    env.CHECKPOINT_SECRET ||
    env.LLM_API_KEY ||
    env.GEMINI_API_KEY ||
    processFallbackSecret
  );
}

function signatureFor(
  payload: string,
  secret: string | Uint8Array,
): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function signCheckpoint(
  state: RunCheckpointState,
  secret: string | Uint8Array = getCheckpointSecret(),
): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString(
    "base64url",
  );
  const signature = signatureFor(payload, secret).toString("base64url");
  return `${payload}.${signature}`;
}

function readState(value: unknown): RunCheckpointState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Checkpoint payload is invalid.");
  }
  const state = value as Record<string, unknown>;
  if (
    state.version !== 1 ||
    typeof state.runId !== "string" ||
    (state.mode !== "protected" && state.mode !== "unprotected") ||
    state.phase !== 1 ||
    !Array.isArray(state.events) ||
    typeof state.handoffEventId !== "string" ||
    !Array.isArray(state.blockedEventIds) ||
    !state.blockedEventIds.every((id) => typeof id === "string") ||
    typeof state.agentTurns !== "number" ||
    state.agentTurns < 0 ||
    state.agentTurns > MAX_AGENT_TURNS ||
    typeof state.activeElapsedMs !== "number" ||
    state.activeElapsedMs < 0 ||
    typeof state.issuedAtEpochSeconds !== "number"
  ) {
    throw new Error("Checkpoint state is invalid.");
  }

  const events = state.events.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Checkpoint contains an invalid event.");
    }
    const event = candidate as unknown as AgentEvent;
    if (
      typeof event.id !== "string" ||
      event.runId !== state.runId ||
      typeof event.timestamp !== "string" ||
      typeof event.content !== "string" ||
      typeof event.rootEventId !== "string" ||
      typeof event.riskScore !== "number" ||
      !Array.isArray(event.flags) ||
      !Array.isArray(event.influencedBy)
    ) {
      throw new Error("Checkpoint contains an invalid event shape.");
    }
    return createAgentEvent({
      id: event.id,
      runId: event.runId,
      timestamp: event.timestamp,
      eventType: event.eventType,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      destinationId: event.destinationId,
      parentEventId: event.parentEventId,
      rootEventId: event.rootEventId,
      content: event.content,
      riskScore: event.riskScore,
      flags: event.flags,
      influencedBy: event.influencedBy,
      metadata: event.metadata,
    });
  });
  if (!events.some((event) => event.id === state.handoffEventId)) {
    throw new Error("Checkpoint handoff event is missing.");
  }

  return Object.freeze({
    version: 1,
    runId: state.runId,
    mode: state.mode,
    phase: 1,
    events: Object.freeze(events),
    handoffEventId: state.handoffEventId,
    blockedEventIds: Object.freeze([...state.blockedEventIds]),
    agentTurns: state.agentTurns,
    activeElapsedMs: state.activeElapsedMs,
    issuedAtEpochSeconds: state.issuedAtEpochSeconds,
  });
}

export function verifyCheckpoint(
  token: string,
  secret: string | Uint8Array = getCheckpointSecret(),
  nowEpochSeconds = Math.floor(Date.now() / 1_000),
): RunCheckpointState {
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra) {
    throw new Error("Checkpoint token is malformed.");
  }
  const actual = Buffer.from(encodedSignature, "base64url");
  const expected = signatureFor(payload, secret);
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new Error("Checkpoint signature is invalid.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Checkpoint payload is invalid JSON.");
  }
  const state = readState(decoded);
  if (
    nowEpochSeconds - state.issuedAtEpochSeconds > CHECKPOINT_TTL_SECONDS ||
    state.issuedAtEpochSeconds - nowEpochSeconds > 60
  ) {
    throw new Error("Checkpoint has expired or is not yet valid.");
  }
  return state;
}
