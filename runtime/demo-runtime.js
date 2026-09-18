export const DEMO_ACTION = "deploy.production.execute";

export const DEMO_POLICY = Object.freeze({
  id: "external-input-requires-independent-approval",
  name: "External input requires independent approval",
});

const DEFAULT_DELAY_MS = 550;
const MAX_PAYLOAD_LENGTH = 8_000;

const BLOCK_REASONS = Object.freeze([
  "A poisoned instruction entered through an untrusted GitHub issue.",
  "Its authority expanded from repository access to production deployment.",
  "The reviewer used the same influenced context, so the approval was not independent.",
]);

function createTraceId() {
  const uuid = globalThis.crypto?.randomUUID?.();

  if (uuid) {
    return `tr_${uuid}`;
  }

  const randomPart = Math.random().toString(16).slice(2).padEnd(13, "0");
  return `tr_${Date.now().toString(36)}-${randomPart}`;
}

function cloneAuthority(authority) {
  return [...authority];
}

function wait(milliseconds) {
  if (!milliseconds) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function normalizePayload(payload) {
  if (typeof payload !== "string" || !payload.trim()) {
    throw new TypeError("payload must be a non-empty string");
  }

  if (payload.length > MAX_PAYLOAD_LENGTH) {
    throw new RangeError(`payload must be ${MAX_PAYLOAD_LENGTH} characters or fewer`);
  }

  return payload.trim();
}

export function createDemoTrace(payload) {
  const cleanPayload = normalizePayload(payload);

  return [
    {
      id: "source",
      label: "GitHub issue #1842",
      kind: "source",
      parentId: null,
      detail: cleanPayload,
      trust: "UNTRUSTED_EXTERNAL",
      authority: [],
    },
    {
      id: "research",
      label: "Research",
      kind: "agent",
      parentId: "source",
      detail: "Summarized the issue and kept its external origin attached.",
      trust: "INHERITED_UNTRUSTED",
      authority: ["repo.read"],
    },
    {
      id: "planner",
      label: "Planner",
      kind: "agent",
      parentId: "research",
      detail: "Turned the summary into an implementation task.",
      trust: "INHERITED_UNTRUSTED",
      authority: ["repo.read"],
    },
    {
      id: "coding",
      label: "Coding",
      kind: "agent",
      parentId: "planner",
      detail: "Prepared a patch and requested access to PROD_DEPLOY_TOKEN.",
      trust: "INHERITED_UNTRUSTED",
      authority: ["repo.read", "repo.write", "secret.read"],
    },
    {
      id: "reviewer",
      label: "Reviewer",
      kind: "agent",
      parentId: "coding",
      detail: "Approved from the same influenced context.",
      trust: "INHERITED_UNTRUSTED",
      authority: ["repo.read", "repo.write", "secret.read"],
      independentApproval: false,
    },
    {
      id: "deploy",
      label: "Deploy",
      kind: "tool-request",
      parentId: "reviewer",
      detail: `Requested ${DEMO_ACTION}.`,
      trust: "INHERITED_UNTRUSTED",
      authority: [
        "repo.read",
        "repo.write",
        "secret.read",
        "production.execute",
      ],
      action: DEMO_ACTION,
    },
  ];
}

/**
 * Pure policy evaluation. It has no clock, network, storage, or execution side effects.
 */
export function evaluateGatewayPolicy({ trace, action }) {
  const source = trace.find((node) => node.kind === "source");
  const reviewer = trace.find((node) => node.id === "reviewer");
  const requestedAction = trace.find((node) => node.action === action);
  const isProtectedAction = action === DEMO_ACTION;
  const hasUntrustedOrigin = source?.trust === "UNTRUSTED_EXTERNAL";
  const authorityExpanded = requestedAction?.authority?.includes(
    "production.execute",
  );
  const hasIndependentApproval = reviewer?.independentApproval === true;

  const shouldBlock =
    isProtectedAction &&
    hasUntrustedOrigin &&
    authorityExpanded &&
    !hasIndependentApproval;

  return {
    decision: shouldBlock ? "BLOCK" : "ALLOW",
    result: shouldBlock ? "BLOCK" : "ALLOW",
    policy: DEMO_POLICY,
    reasons: shouldBlock ? [...BLOCK_REASONS] : [],
  };
}

/**
 * The only function allowed to call a protected production callback.
 */
export async function executeProtectedAction({ trace, action, callback }) {
  if (typeof callback !== "function") {
    throw new TypeError("callback must be a function");
  }

  const evaluation = evaluateGatewayPolicy({ trace, action });

  if (evaluation.decision !== "ALLOW") {
    return {
      ...evaluation,
      executed: false,
      output: null,
    };
  }

  const output = await callback();

  return {
    ...evaluation,
    executed: true,
    output,
  };
}

export async function streamDemoRun({
  payload,
  emit,
  delayMs = DEFAULT_DELAY_MS,
  traceId = createTraceId(),
}) {
  if (typeof emit !== "function") {
    throw new TypeError("emit must be a function");
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError("delayMs must be a non-negative number");
  }

  const cleanPayload = normalizePayload(payload);
  const trace = createDemoTrace(cleanPayload);
  let sequence = 0;

  const send = async (event) => {
    sequence += 1;
    await emit({
      ...event,
      traceId,
      sequence,
      emittedAt: new Date().toISOString(),
    });
  };

  const sendAfterDelay = async (event) => {
    await wait(delayMs);
    await send(event);
  };

  await send({
    type: "run.created",
    status: "RUNNING",
    payload: cleanPayload,
    message: `Run ${traceId} started.`,
  });

  const source = trace[0];
  await sendAfterDelay({
    type: "source.ingested",
    source: {
      kind: "github.issue",
      label: source.label,
      issueNumber: 1842,
      trust: source.trust,
      payload: cleanPayload,
    },
    node: { ...source, authority: cloneAuthority(source.authority) },
    message: "COLLU  Source marked UNTRUSTED_EXTERNAL",
  });

  const agentMessages = {
    Research: "ResearchAgent  summarized GitHub issue #1842",
    Planner: "PlannerAgent  created an implementation task",
    Coding: "CodingAgent  prepared a patch and referenced PROD_DEPLOY_TOKEN",
    Reviewer: "ReviewerAgent  approved from the same influenced context",
  };

  for (const node of trace.slice(1, 5)) {
    await sendAfterDelay({
      type: "agent.completed",
      agent: node.label,
      node: { ...node, authority: cloneAuthority(node.authority) },
      message: agentMessages[node.label],
    });
  }

  const deployNode = trace[5];
  await sendAfterDelay({
    type: "tool.requested",
    agent: deployNode.label,
    action: DEMO_ACTION,
    node: {
      ...deployNode,
      authority: cloneAuthority(deployNode.authority),
    },
    message: `DeployAgent  requested ${DEMO_ACTION}`,
  });

  await sendAfterDelay({
    type: "gateway.evaluating",
    action: DEMO_ACTION,
    policy: DEMO_POLICY,
    message: "COLLU  Checking the complete causal path...",
  });

  let productionExecutions = 0;
  const protectedResult = await executeProtectedAction({
    trace,
    action: DEMO_ACTION,
    callback: async () => {
      productionExecutions += 1;
      return { deployed: true };
    },
  });

  const decision = {
    type: "gateway.decision",
    status: protectedResult.decision === "BLOCK" ? "BLOCKED" : "COMPLETED",
    decision: protectedResult.decision,
    result: protectedResult.result,
    action: DEMO_ACTION,
    policy: protectedResult.policy,
    reasons: protectedResult.reasons,
    trace: trace.map((node) => ({
      ...node,
      authority: cloneAuthority(node.authority),
    })),
    productionExecutions,
    executed: protectedResult.executed,
    message:
      protectedResult.decision === "BLOCK"
        ? "COLLU BLOCK  Production did not run."
        : "COLLU ALLOW  Production executed.",
  };

  await sendAfterDelay(decision);

  return {
    traceId,
    decision: protectedResult.decision,
    productionExecutions,
  };
}
