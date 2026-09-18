import { RISK_BLOCK_THRESHOLD } from "@/lib/config";
import type {
  AgentEvent,
  RunMode,
  SandboxActionName,
  SandboxDecision,
  VirtualReceipt,
  VirtualToolResult,
  WorkingBrief,
} from "@/types/events";

export interface SandboxResult extends VirtualToolResult {}

function isPurchaseAction(
  action: Exclude<SandboxActionName, "none">,
): action is "simulate_purchase" | "stage_purchase" {
  return action === "simulate_purchase" || action === "stage_purchase";
}

export function workingBriefFromEvent(
  event: AgentEvent,
): WorkingBrief | undefined {
  const value = event.metadata?.workingBrief;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.item !== "string" ||
    typeof candidate.quantity !== "number" ||
    typeof candidate.unitPriceCents !== "number" ||
    candidate.currency !== "USD" ||
    typeof candidate.budgetCapCents !== "number" ||
    typeof candidate.budgetCapEnabled !== "boolean" ||
    typeof candidate.approvalThresholdCents !== "number" ||
    typeof candidate.freshApprovalRequired !== "boolean" ||
    typeof candidate.freshApprovalGranted !== "boolean"
  ) {
    return undefined;
  }
  return candidate as unknown as WorkingBrief;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Pure policy decision. No external tool implementation exists in the MVP. */
export function evaluateSandboxAction(
  action: Exclude<SandboxActionName, "none">,
  event: AgentEvent,
  mode: RunMode,
): SandboxResult {
  let decision: SandboxDecision = "allowed";
  if (mode === "protected" && event.riskScore >= RISK_BLOCK_THRESHOLD) {
    decision = "blocked";
  } else if (isPurchaseAction(action)) {
    const brief = workingBriefFromEvent(event);
    const total = brief ? brief.quantity * brief.unitPriceCents : 0;
    const missingApproval = Boolean(
      brief?.freshApprovalRequired && !brief.freshApprovalGranted,
    );
    const overBudget = Boolean(
      brief?.budgetCapEnabled && total > brief.budgetCapCents,
    );
    if (missingApproval || overBudget) decision = "requires_review";
  } else if (action === "approve_request" || event.riskScore >= 60) {
    decision = "requires_review";
  }

  if (isPurchaseAction(action)) {
    const brief = workingBriefFromEvent(event);
    const item = brief?.item ?? "purchase";
    const quantity = brief?.quantity ?? 0;
    const unitPriceCents = brief?.unitPriceCents ?? 0;
    const projectedTotalCents = quantity * unitPriceCents;
    const receipt: VirtualReceipt = Object.freeze({
      receiptId: `virtual_${event.id}`,
      action,
      item,
      quantity,
      unitPriceCents,
      projectedTotalCents,
      currency: "USD",
      status:
        decision === "allowed"
          ? "staged"
          : decision === "blocked"
            ? "blocked"
            : "held_for_review",
      chargedCents: 0,
      externalEffects: 0,
    });
    const outcome =
      decision === "allowed"
        ? "staged"
        : decision === "blocked"
          ? "blocked"
          : "held for fresh approval";
    return Object.freeze({
      action,
      decision,
      receipt,
      chargedCents: 0,
      externalEffects: 0,
      summary: `Virtual purchase ${outcome}: ${quantity} × ${item} at ${money(unitPriceCents)} (${money(projectedTotalCents)} projected). Charged ${money(0)}; external effects 0; no external system was contacted.`,
    });
  }

  return Object.freeze({
    action,
    decision,
    chargedCents: 0,
    externalEffects: 0,
    summary:
      decision === "allowed"
        ? `Sandbox recorded ${action}; no external system was contacted.`
        : decision === "blocked"
          ? `Sandbox blocked ${action}; no external system was contacted.`
          : `Sandbox held ${action} for review; no external system was contacted.`,
  });
}
