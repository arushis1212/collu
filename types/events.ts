export const AGENT_IDS = [
  "coordinator",
  "research",
  "analysis",
  "execution",
  "reviewer",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];
export type AgentRole = AgentId;

export type EventType =
  | "user_input"
  | "agent_message"
  | "tool_request"
  | "tool_result"
  | "security_alert"
  | "attack_injection"
  | "final_output";

export type SourceType = "human" | "agent" | "tool" | "security";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RunMode = "protected" | "unprotected";

export interface AgentEvent {
  readonly id: string;
  readonly runId: string;
  readonly timestamp: string;
  readonly eventType: EventType;
  readonly sourceType: SourceType;
  /** The real sender assigned by the runtime. Model text can never replace it. */
  readonly sourceId: string;
  readonly destinationId?: string;
  readonly parentEventId?: string;
  readonly rootEventId: string;
  readonly content: string;
  readonly riskScore: number;
  readonly riskLevel: RiskLevel;
  readonly flags: readonly string[];
  /** Ordered, de-duplicated IDs of the exact events supplied to an LLM call. */
  readonly influencedBy: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SecurityAssessment {
  readonly riskScore: number;
  readonly classification:
    | "benign"
    | "prompt_injection"
    | "role_impersonation"
    | "policy_bypass"
    | "sensitive_action"
    | "unknown";
  readonly flags: readonly string[];
  readonly reason: string;
  readonly shouldEscalate: boolean;
  readonly source: "deterministic" | "judge" | "combined";
  /** Exact deterministic matches and weights used before any advisory judge. */
  readonly ruleEvidence?: readonly {
    readonly flag: string;
    readonly weight: number;
  }[];
}

export const SANDBOX_ACTIONS = [
  "none",
  "update_record",
  "send_result",
  "approve_request",
  "simulate_purchase",
  "stage_purchase",
] as const;

export type SandboxActionName = (typeof SANDBOX_ACTIONS)[number];
export type SandboxDecision = "allowed" | "blocked" | "requires_review";

export interface WorkingBrief {
  readonly item: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly currency: "USD";
  readonly budgetCapCents: number;
  readonly budgetCapEnabled: boolean;
  readonly approvalThresholdCents: number;
  readonly freshApprovalRequired: boolean;
  readonly freshApprovalGranted: boolean;
}

export type ScenarioPhase =
  | "intake"
  | "sourcing"
  | "evaluating"
  | "staging"
  | "reviewing"
  | "complete";

export type BudgetStatus =
  | "within_budget"
  | "over_budget"
  | "no_cap"
  | "unknown";

export type ApprovalStatus =
  | "not_required"
  | "missing"
  | "granted"
  | "unknown";

export type OrderStatus =
  | "draft"
  | "ready"
  | "staged"
  | "held"
  | "complete";

export interface ScenarioState {
  readonly phase: ScenarioPhase;
  readonly projectedTotalCents: number;
  readonly budgetStatus: BudgetStatus;
  readonly approvalStatus: ApprovalStatus;
  readonly orderStatus: OrderStatus;
}

export type VirtualReceiptStatus =
  | "staged"
  | "held_for_review"
  | "blocked";

export interface VirtualReceipt {
  readonly receiptId: string;
  readonly action: "simulate_purchase" | "stage_purchase";
  readonly item: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly projectedTotalCents: number;
  readonly currency: "USD";
  readonly status: VirtualReceiptStatus;
  readonly chargedCents: 0;
  readonly externalEffects: 0;
}

export interface VirtualToolResult {
  readonly action: Exclude<SandboxActionName, "none">;
  readonly decision: SandboxDecision;
  readonly summary: string;
  readonly chargedCents: 0;
  readonly externalEffects: 0;
  readonly receipt?: VirtualReceipt;
}

export interface AgentOutput {
  readonly message: string;
  readonly action: SandboxActionName;
  readonly actionInput: string;
  readonly final: boolean;
  readonly workingBrief: WorkingBrief;
  readonly scenarioState: ScenarioState;
  /** Short, public progress notes. Never private chain-of-thought. */
  readonly worklog: readonly string[];
  readonly nextStep: string;
}

export interface AgentCallResult {
  readonly output: AgentOutput;
  readonly model: string;
  readonly interactionId?: string;
  readonly failed: boolean;
  readonly errorCode?: string;
}

export type AttackKind =
  | "human_injection"
  | "agent_poisoning"
  | "propagation_attack";

export interface AttackRequest {
  readonly type: AttackKind;
}

export interface StartRunRequest {
  readonly action: "start";
  readonly prompt: string;
  readonly mode: RunMode;
}

export interface ContinueRunRequest {
  readonly action: "continue";
  readonly checkpoint: string;
  readonly attack?: AttackRequest;
}

export type RunRequest = StartRunRequest | ContinueRunRequest;

export interface RunLimits {
  readonly maxAgents: number;
  readonly maxAgentTurns: number;
  readonly maxRunDurationSeconds: number;
  readonly maxOutputTokensPerAgent: number;
  readonly maxContextEventsPerCall: number;
  readonly riskBlockThreshold: number;
}

export type StreamEnvelope =
  | {
      readonly type: "run_started";
      readonly runId: string;
      readonly phase: 1 | 2;
      readonly mode: RunMode;
      readonly limits: RunLimits;
    }
  | { readonly type: "event"; readonly event: AgentEvent }
  | {
      readonly type: "checkpoint";
      readonly runId: string;
      readonly phase: 1;
      readonly checkpoint: string;
      readonly canInject: true;
    }
  | {
      readonly type: "complete";
      readonly runId: string;
      readonly phase: 1 | 2;
      readonly status: "paused" | "complete" | "limit_reached" | "error";
      readonly eventCount: number;
      readonly message?: string;
    };
