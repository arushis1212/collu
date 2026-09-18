import { randomUUID } from "node:crypto";

import {
  callAgent as defaultCallAgent,
  fallbackAgentOutput,
  type CallAgentInput,
} from "@/lib/agents";
import { resolveAttack } from "@/lib/attacks";
import {
  getCheckpointSecret,
  signCheckpoint,
  verifyCheckpoint,
  type RunCheckpointState,
} from "@/lib/checkpoint";
import {
  MAX_AGENT_TURNS,
  MAX_RUN_DURATION_SECONDS,
  RISK_BLOCK_THRESHOLD,
  RUN_LIMITS,
} from "@/lib/config";
import {
  applyContextExposure,
  applySecurityAssessment,
  createAgentEvent,
  orderedUniqueEventIds,
  type CreateAgentEventInput,
} from "@/lib/events";
import { getContextForAgent } from "@/lib/provenance";
import { evaluateSandboxAction } from "@/lib/sandbox";
import { runSecurityJudge } from "@/lib/security/judge";
import {
  eventIsSensitive,
  extractClaimedIdentity,
  runSecurityRules,
} from "@/lib/security/rules";
import type {
  AgentCallResult,
  AgentEvent,
  AgentId,
  AgentOutput,
  ContinueRunRequest,
  RunMode,
  RunRequest,
  SecurityAssessment,
  StartRunRequest,
  StreamEnvelope,
} from "@/types/events";

const PHASE_TWO_AGENTS: readonly AgentId[] = Object.freeze([
  "research",
  "analysis",
  "execution",
  "reviewer",
]);

export const NEXT_AGENT: Readonly<Partial<Record<AgentId, AgentId>>> =
  Object.freeze({
    coordinator: "research",
    research: "analysis",
    analysis: "execution",
    execution: "reviewer",
  });

export type AgentCaller = (
  input: CallAgentInput,
) => Promise<AgentCallResult | AgentOutput>;

export type SecurityJudge = (
  event: AgentEvent,
  local: SecurityAssessment,
) => Promise<SecurityAssessment>;

export interface OrchestratorDependencies {
  readonly callAgent?: AgentCaller;
  readonly judge?: SecurityJudge;
  readonly idFactory?: () => string;
  readonly now?: () => Date;
  readonly clock?: () => number;
  readonly checkpointSecret?: string | Uint8Array;
}

interface Runtime {
  readonly dependencies: OrchestratorDependencies;
  readonly idFactory: () => string;
  readonly now: () => Date;
  readonly clock: () => number;
  readonly checkpointSecret: string | Uint8Array;
}

function makeRuntime(dependencies: OrchestratorDependencies): Runtime {
  return {
    dependencies,
    idFactory: dependencies.idFactory ?? randomUUID,
    now: dependencies.now ?? (() => new Date()),
    clock: dependencies.clock ?? Date.now,
    checkpointSecret:
      dependencies.checkpointSecret ?? getCheckpointSecret(),
  };
}

function metadataWithClaimedIdentity(
  content: string,
  metadata: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const claimedSourceId = extractClaimedIdentity(content);
  return Object.freeze({
    ...metadata,
    ...(claimedSourceId ? { claimedSourceId } : {}),
  });
}

function makeEvent(
  runtime: Runtime,
  input: Omit<CreateAgentEventInput, "id" | "timestamp">,
): AgentEvent {
  return createAgentEvent({
    ...input,
    id: runtime.idFactory(),
    timestamp: runtime.now().toISOString(),
    metadata: metadataWithClaimedIdentity(
      input.content,
      input.metadata ?? {},
    ),
  });
}

function ensureDeterministicFloor(
  local: SecurityAssessment,
  advisory: SecurityAssessment,
): SecurityAssessment {
  return Object.freeze({
    riskScore: Math.max(local.riskScore, advisory.riskScore),
    classification:
      advisory.riskScore >= local.riskScore
        ? advisory.classification
        : local.classification,
    flags: Object.freeze([...new Set([...local.flags, ...advisory.flags])]),
    reason:
      advisory === local
        ? local.reason
        : `${local.reason} Advisory: ${advisory.reason}`,
    shouldEscalate: local.shouldEscalate || advisory.shouldEscalate,
    source: advisory === local ? local.source : "combined",
    ...(local.ruleEvidence ? { ruleEvidence: local.ruleEvidence } : {}),
  });
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (timeoutMs <= 0) throw new Error("run_deadline_exceeded");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("run_deadline_exceeded")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function remainingRunMs(
  activeElapsedMs: number,
  phaseStartedAt: number,
  runtime: Runtime,
): number {
  const currentPhaseMs = Math.max(0, runtime.clock() - phaseStartedAt);
  return Math.max(
    0,
    MAX_RUN_DURATION_SECONDS * 1_000 - activeElapsedMs - currentPhaseMs,
  );
}

async function assessEvent(
  event: AgentEvent,
  context: readonly AgentEvent[],
  runtime: Runtime,
  remainingMs: number,
): Promise<AgentEvent> {
  const local = runSecurityRules(event);
  let assessment = local;
  if (local.shouldEscalate || eventIsSensitive(event)) {
    try {
      const judge = runtime.dependencies.judge ?? runSecurityJudge;
      const advisory = await withTimeout(
        Promise.resolve(judge(event, local)),
        remainingMs,
      );
      assessment = ensureDeterministicFloor(local, advisory);
    } catch {
      assessment = Object.freeze({
        ...local,
        flags: Object.freeze([
          ...new Set([...local.flags, "security_judge_failed"]),
        ]),
        reason: `${local.reason} Advisory judge failed; deterministic score retained.`,
        source: "combined",
      });
    }
  }
  const assessed = applySecurityAssessment(event, assessment);
  return applyContextExposure(assessed, context);
}

export function shouldBlockEvent(event: AgentEvent, mode: RunMode): boolean {
  return mode === "protected" && event.riskScore >= RISK_BLOCK_THRESHOLD;
}

export function createBlockedSecurityEvent(
  blockedEvent: AgentEvent,
  dependencies: OrchestratorDependencies = {},
): AgentEvent {
  const runtime = makeRuntime(dependencies);
  return makeEvent(runtime, {
    runId: blockedEvent.runId,
    eventType: "security_alert",
    sourceType: "security",
    sourceId: "security",
    destinationId: blockedEvent.destinationId,
    parentEventId: blockedEvent.id,
    rootEventId: blockedEvent.rootEventId,
    content: `Protected mode blocked event ${blockedEvent.id} at the trust boundary.`,
    riskScore: blockedEvent.riskScore,
    flags: [...blockedEvent.flags, "blocked_by_policy"],
    influencedBy: [blockedEvent.id],
    metadata: {
      blockedEventId: blockedEvent.id,
      edgeStatus: "blocked",
      threshold: RISK_BLOCK_THRESHOLD,
    },
  });
}

function normalizeCallResult(
  value: AgentCallResult | AgentOutput,
): AgentCallResult {
  if ("output" in value) return value;
  return Object.freeze({
    output: value,
    model: "injected-test-model",
    failed: false,
  });
}

async function invokeAgent(
  agent: AgentId,
  incomingEvent: AgentEvent,
  context: readonly AgentEvent[],
  runtime: Runtime,
  remainingMs: number,
): Promise<AgentCallResult> {
  const caller = runtime.dependencies.callAgent ?? defaultCallAgent;
  try {
    const value = await withTimeout(
      Promise.resolve(caller({ agent, incomingEvent, context })),
      remainingMs,
    );
    return normalizeCallResult(value);
  } catch (error) {
    return Object.freeze({
      output: fallbackAgentOutput(agent),
      model: "unavailable",
      failed: true,
      errorCode:
        error instanceof Error && error.message === "run_deadline_exceeded"
          ? "run_deadline_exceeded"
          : "model_request_failed",
    });
  }
}

function agentMetadata(
  result: AgentCallResult,
): Readonly<Record<string, unknown>> {
  return {
    model: result.model,
    modelFailed: result.failed,
    ...(result.interactionId
      ? { interactionId: result.interactionId }
      : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    workingBrief: result.output.workingBrief,
    scenarioState: result.output.scenarioState,
    worklog: result.output.worklog,
    nextStep: result.output.nextStep,
  };
}

function createAttackEvent(
  request: NonNullable<ContinueRunRequest["attack"]>,
  runId: string,
  runtime: Runtime,
): { event: AgentEvent; target: AgentId } {
  const resolved = resolveAttack(request);
  const target =
    resolved.targetAgent === "coordinator"
      ? "research"
      : resolved.targetAgent;
  let sourceId = resolved.actualSourceId;
  if (resolved.actualSourceType === "agent" && sourceId === target) {
    sourceId = "coordinator";
  }
  return {
    target,
    event: makeEvent(runtime, {
      runId,
      eventType: "attack_injection",
      sourceType: resolved.actualSourceType,
      sourceId,
      destinationId: target,
      content: resolved.payload,
      influencedBy: [],
      metadata: {
        attackType: resolved.type,
        controlledSimulation: true,
        actualSourceId: sourceId,
        actualSourceType: resolved.actualSourceType,
        ...(resolved.claimedSourceId
          ? { claimedSourceId: resolved.claimedSourceId }
          : {}),
        ...(resolved.targetAgent === "coordinator"
          ? { requestedTarget: "coordinator", effectiveTarget: target }
          : {}),
        ...(resolved.workingBrief
          ? {
              workingBrief: resolved.workingBrief,
              forgedWorkingBrief: true,
            }
          : {}),
        ...(resolved.scenarioState
          ? { scenarioState: resolved.scenarioState }
          : {}),
        ...(resolved.worklog ? { worklog: resolved.worklog } : {}),
        ...(resolved.nextStep ? { nextStep: resolved.nextStep } : {}),
      },
    }),
  };
}

function elapsedForCheckpoint(
  priorElapsed: number,
  phaseStartedAt: number,
  runtime: Runtime,
): number {
  return Math.max(
    0,
    priorElapsed + Math.max(0, runtime.clock() - phaseStartedAt),
  );
}

export async function* startRun(
  request: StartRunRequest,
  dependencies: OrchestratorDependencies = {},
): AsyncGenerator<StreamEnvelope> {
  const runtime = makeRuntime(dependencies);
  const phaseStartedAt = runtime.clock();
  const runId = `run_${runtime.idFactory()}`;
  const events: AgentEvent[] = [];
  const blockedEventIds = new Set<string>();
  let agentTurns = 0;

  yield {
    type: "run_started",
    runId,
    phase: 1,
    mode: request.mode,
    limits: RUN_LIMITS,
  };

  let incoming = makeEvent(runtime, {
    runId,
    eventType: "user_input",
    sourceType: "human",
    sourceId: "human",
    destinationId: "coordinator",
    content: request.prompt,
    influencedBy: [],
    metadata: { actualSourceId: "human", actualSourceType: "human" },
  });
  incoming = await assessEvent(
    incoming,
    [],
    runtime,
    remainingRunMs(0, phaseStartedAt, runtime),
  );
  events.push(incoming);
  yield { type: "event", event: incoming };

  if (shouldBlockEvent(incoming, request.mode)) {
    blockedEventIds.add(incoming.id);
    const alert = createBlockedSecurityEvent(incoming, {
      ...dependencies,
      idFactory: runtime.idFactory,
      now: runtime.now,
    });
    events.push(alert);
    yield { type: "event", event: alert };
    incoming = alert;
  }

  const coordinatorContext = getContextForAgent(events, incoming, {
    blockedEventIds,
  });
  agentTurns += 1;
  const coordinatorResult = await invokeAgent(
    "coordinator",
    incoming,
    coordinatorContext,
    runtime,
    Math.max(1, remainingRunMs(0, phaseStartedAt, runtime)),
  );
  let coordinatorEvent = makeEvent(runtime, {
    runId,
    eventType: "agent_message",
    sourceType: "agent",
    sourceId: "coordinator",
    destinationId: "research",
    parentEventId: incoming.id,
    rootEventId: incoming.rootEventId,
    content: coordinatorResult.output.message,
    influencedBy: orderedUniqueEventIds(coordinatorContext),
    metadata: agentMetadata(coordinatorResult),
  });
  coordinatorEvent = await assessEvent(
    coordinatorEvent,
    coordinatorContext,
    runtime,
    Math.max(1, remainingRunMs(0, phaseStartedAt, runtime)),
  );
  events.push(coordinatorEvent);
  yield { type: "event", event: coordinatorEvent };

  let handoffEvent = coordinatorEvent;
  if (shouldBlockEvent(coordinatorEvent, request.mode)) {
    blockedEventIds.add(coordinatorEvent.id);
    const alert = createBlockedSecurityEvent(coordinatorEvent, {
      ...dependencies,
      idFactory: runtime.idFactory,
      now: runtime.now,
    });
    events.push(alert);
    yield { type: "event", event: alert };
    // Continue from the last safe input. The alert is observable evidence, not
    // a replacement message or an agent context carrier.
    handoffEvent = incoming;
  }

  const state: RunCheckpointState = Object.freeze({
    version: 1,
    runId,
    mode: request.mode,
    phase: 1,
    events: Object.freeze([...events]),
    handoffEventId: handoffEvent.id,
    blockedEventIds: Object.freeze([...blockedEventIds]),
    agentTurns,
    activeElapsedMs: elapsedForCheckpoint(0, phaseStartedAt, runtime),
    issuedAtEpochSeconds: Math.floor(runtime.now().getTime() / 1_000),
  });
  const checkpoint = signCheckpoint(state, runtime.checkpointSecret);
  yield {
    type: "checkpoint",
    runId,
    phase: 1,
    checkpoint,
    canInject: true,
  };
  yield {
    type: "complete",
    runId,
    phase: 1,
    status: "paused",
    eventCount: events.length,
  };
}

function makeToolResultEvent(
  requestEvent: AgentEvent,
  decision: ReturnType<typeof evaluateSandboxAction>,
  runtime: Runtime,
  inheritExposure: boolean,
): AgentEvent {
  const priorState = requestEvent.metadata?.scenarioState;
  const scenarioState =
    priorState && typeof priorState === "object" && !Array.isArray(priorState)
      ? {
          ...(priorState as Readonly<Record<string, unknown>>),
          phase: "reviewing",
          orderStatus:
            decision.decision === "allowed"
              ? "staged"
              : decision.decision === "blocked"
                ? "held"
                : "held",
        }
      : undefined;
  let result = makeEvent(runtime, {
    runId: requestEvent.runId,
    eventType: "tool_result",
    sourceType: "tool",
    sourceId: "sandbox",
    destinationId: "reviewer",
    parentEventId: requestEvent.id,
    rootEventId: requestEvent.rootEventId,
    content: decision.summary,
    influencedBy: [requestEvent.id],
    metadata: {
      actionName: decision.action,
      decision: decision.decision,
      sandboxed: true,
      externalEffects: decision.externalEffects,
      chargedCents: decision.chargedCents,
      ...(decision.receipt ? { receipt: decision.receipt } : {}),
      ...(requestEvent.metadata?.workingBrief
        ? { workingBrief: requestEvent.metadata.workingBrief }
        : {}),
      ...(scenarioState ? { scenarioState } : {}),
      ...(requestEvent.metadata?.worklog
        ? { worklog: requestEvent.metadata.worklog }
        : {}),
      nextStep: "Reviewer checks the virtual receipt and working brief.",
    },
  });
  if (inheritExposure) result = applyContextExposure(result, [requestEvent]);
  return result;
}

export async function* continueRun(
  request: ContinueRunRequest,
  dependencies: OrchestratorDependencies = {},
): AsyncGenerator<StreamEnvelope> {
  const runtime = makeRuntime(dependencies);
  const state = verifyCheckpoint(
    request.checkpoint,
    runtime.checkpointSecret,
    Math.floor(runtime.now().getTime() / 1_000),
  );
  const phaseStartedAt = runtime.clock();
  const events = [...state.events];
  const blockedEventIds = new Set(state.blockedEventIds);
  let agentTurns = state.agentTurns;
  let handoffEvent = events.find(
    (event) => event.id === state.handoffEventId,
  )!;
  const preparedAttack = request.attack
    ? createAttackEvent(request.attack, state.runId, runtime)
    : undefined;
  let attackInjected = false;

  yield {
    type: "run_started",
    runId: state.runId,
    phase: 2,
    mode: state.mode,
    limits: RUN_LIMITS,
  };

  for (const agent of PHASE_TWO_AGENTS) {
    if (
      agentTurns >= MAX_AGENT_TURNS ||
      remainingRunMs(state.activeElapsedMs, phaseStartedAt, runtime) <= 0
    ) {
      yield {
        type: "complete",
        runId: state.runId,
        phase: 2,
        status: "limit_reached",
        eventCount: events.length,
        message: "The hard run limit was reached before another model call.",
      };
      return;
    }

    let incoming = handoffEvent;
    let seedEventIds: readonly string[] = [];
    if (
      preparedAttack &&
      !attackInjected &&
      preparedAttack.target === agent
    ) {
      let attackEvent = await assessEvent(
        preparedAttack.event,
        [],
        runtime,
        Math.max(
          1,
          remainingRunMs(state.activeElapsedMs, phaseStartedAt, runtime),
        ),
      );
      events.push(attackEvent);
      yield { type: "event", event: attackEvent };
      attackInjected = true;

      if (shouldBlockEvent(attackEvent, state.mode)) {
        blockedEventIds.add(attackEvent.id);
        const alert = createBlockedSecurityEvent(attackEvent, {
          ...dependencies,
          idFactory: runtime.idFactory,
          now: runtime.now,
        });
        events.push(alert);
        yield { type: "event", event: alert };
      } else {
        incoming = attackEvent;
        seedEventIds = [handoffEvent.id];
      }
    }

    const context = getContextForAgent(events, incoming, {
      blockedEventIds,
      seedEventIds,
    });
    agentTurns += 1;
    const result = await invokeAgent(
      agent,
      incoming,
      context,
      runtime,
      Math.max(
        1,
        remainingRunMs(state.activeElapsedMs, phaseStartedAt, runtime),
      ),
    );
    const nextAgent = NEXT_AGENT[agent];
    const isFinal = agent === "reviewer";
    const action = result.output.action;
    let agentEvent = makeEvent(runtime, {
      runId: state.runId,
      eventType: isFinal ? "final_output" : "agent_message",
      sourceType: "agent",
      sourceId: agent,
      destinationId:
        agent === "execution" && action !== "none"
          ? "sandbox"
          : nextAgent,
      parentEventId: incoming.id,
      rootEventId: incoming.rootEventId,
      content: result.output.message,
      influencedBy: orderedUniqueEventIds(context),
      metadata: {
        ...agentMetadata(result),
        modelDeclaredFinal: result.output.final,
        proposedAction: action,
      },
    });
    agentEvent = await assessEvent(
      agentEvent,
      context,
      runtime,
      Math.max(
        1,
        remainingRunMs(state.activeElapsedMs, phaseStartedAt, runtime),
      ),
    );
    events.push(agentEvent);
    yield { type: "event", event: agentEvent };

    if (shouldBlockEvent(agentEvent, state.mode)) {
      blockedEventIds.add(agentEvent.id);
      const alert = createBlockedSecurityEvent(agentEvent, {
        ...dependencies,
        idFactory: runtime.idFactory,
        now: runtime.now,
      });
      events.push(alert);
      yield { type: "event", event: alert };
      // Preserve continuity from the last safe handoff without laundering the
      // blocked output through a security-alert event.
      handoffEvent = incoming;
      if (isFinal) break;
      continue;
    }

    handoffEvent = agentEvent;
    if (agent === "execution" && action !== "none") {
      let toolRequest = makeEvent(runtime, {
        runId: state.runId,
        eventType: "tool_request",
        sourceType: "agent",
        sourceId: "execution",
        destinationId: "sandbox",
        parentEventId: agentEvent.id,
        rootEventId: agentEvent.rootEventId,
        content: `Request ${action}: ${result.output.actionInput}`,
        influencedBy: [agentEvent.id],
        metadata: {
          actionName: action,
          actionInput: result.output.actionInput,
          sandboxed: true,
          workingBrief: result.output.workingBrief,
          scenarioState: result.output.scenarioState,
          worklog: result.output.worklog,
          nextStep: result.output.nextStep,
        },
      });
      toolRequest = await assessEvent(
        toolRequest,
        [agentEvent],
        runtime,
        Math.max(
          1,
          remainingRunMs(state.activeElapsedMs, phaseStartedAt, runtime),
        ),
      );
      events.push(toolRequest);
      yield { type: "event", event: toolRequest };

      const blocked = shouldBlockEvent(toolRequest, state.mode);
      if (blocked) {
        blockedEventIds.add(toolRequest.id);
        const alert = createBlockedSecurityEvent(toolRequest, {
          ...dependencies,
          idFactory: runtime.idFactory,
          now: runtime.now,
        });
        events.push(alert);
        yield { type: "event", event: alert };
      }
      const sandboxDecision = evaluateSandboxAction(
        action,
        toolRequest,
        state.mode,
      );
      const toolResult = makeToolResultEvent(
        toolRequest,
        sandboxDecision,
        runtime,
        !blocked,
      );
      events.push(toolResult);
      yield { type: "event", event: toolResult };
      handoffEvent = toolResult;
    }
  }

  yield {
    type: "complete",
    runId: state.runId,
    phase: 2,
    status:
      remainingRunMs(state.activeElapsedMs, phaseStartedAt, runtime) <= 0
        ? "limit_reached"
        : "complete",
    eventCount: events.length,
  };
}

export function orchestrate(
  request: RunRequest,
  dependencies: OrchestratorDependencies = {},
): AsyncGenerator<StreamEnvelope> {
  return request.action === "start"
    ? startRun(request, dependencies)
    : continueRun(request, dependencies);
}
