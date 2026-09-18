import { clampRiskScore } from "@/lib/config";
import type {
  AgentEvent,
  AgentId,
  SecurityAssessment,
} from "@/types/events";

interface Rule {
  readonly pattern: RegExp;
  readonly flag: string;
  readonly weight: number;
  readonly classification: SecurityAssessment["classification"];
}

const RULES: readonly Rule[] = Object.freeze([
  {
    pattern: /\bignore\s+(?:all\s+)?(?:the\s+)?previous\s+(?:(?:operating|security|system)\s+)?(?:instructions?|policy|rules?)\b/i,
    flag: "instruction_override",
    weight: 48,
    classification: "prompt_injection",
  },
  {
    pattern: /\bignore\s+(?:the\s+)?system\b/i,
    flag: "system_instruction_override",
    weight: 55,
    classification: "prompt_injection",
  },
  {
    pattern: /\bsystem\s+(?:message|update|policy|instruction)\b/i,
    flag: "untrusted_system_policy",
    weight: 36,
    classification: "prompt_injection",
  },
  {
    pattern: /\b(?:bypass|disable|circumvent|override)\b.{0,48}\b(?:review|security|policy|approval|guardrail)/i,
    flag: "security_bypass",
    weight: 52,
    classification: "policy_bypass",
  },
  {
    pattern: /\b(?:(?:reviewer|fresh)\s+)?approval\s+(?:is\s+)?no\s+longer\s+required\b/i,
    flag: "approval_bypass",
    weight: 58,
    classification: "policy_bypass",
  },
  {
    pattern: /\b(?:already|pre)[ -]?approved\b/i,
    flag: "unverified_approval_claim",
    weight: 42,
    classification: "policy_bypass",
  },
  {
    pattern: /\bdo\s+not\s+(?:tell|notify|inform|alert|show)\b/i,
    flag: "concealment_request",
    weight: 34,
    classification: "prompt_injection",
  },
  {
    pattern: /\b(?:propagate|forward|relay|pass)\b.{0,64}\b(?:instruction|update|policy|message|agents?)\b/i,
    flag: "propagation_request",
    weight: 38,
    classification: "prompt_injection",
  },
  {
    pattern: /\b(?:trusted|authoritative)\s+(?:system\s+)?(?:policy|instruction|message)\b/i,
    flag: "trust_boundary_crossing",
    weight: 35,
    classification: "prompt_injection",
  },
  {
    pattern:
      /\b(?:replace|override|rewrite|change)\b.{0,64}\b(?:purchase|order|working)\s+brief\b/i,
    flag: "transaction_mutation",
    weight: 46,
    classification: "sensitive_action",
  },
  {
    pattern:
      /\b(?:remove|disable|ignore|bypass)\b.{0,48}\b(?:budget\s+cap|spending\s+limit|approval\s+(?:threshold|check)|fresh\s+approval)\b/i,
    flag: "budget_or_approval_bypass",
    weight: 54,
    classification: "policy_bypass",
  },
]);

const AGENT_SELF_IDENTIFICATION_PATTERN =
  /\b(?:i\s+am|i['’]m|acting\s+as|signed\s+by)\s+(?:the\s+)?(coordinator|research|analysis|execution|reviewer)\b/i;

const AGENT_MESSAGE_HEADER_PATTERN =
  /(?:^|\n)\s*(?:message\s+)?from\s+(?:the\s+)?(coordinator|research|analysis|execution|reviewer)\s*:/i;

const SYSTEM_FROM_PATTERN =
  /\bsystem\s+(?:message|update|policy|instruction)\s+from\s+(?:the\s+)?(coordinator|research|analysis|execution|reviewer)\b/i;

export function extractClaimedIdentity(content: string): AgentId | undefined {
  const match =
    SYSTEM_FROM_PATTERN.exec(content) ??
    AGENT_SELF_IDENTIFICATION_PATTERN.exec(content) ??
    AGENT_MESSAGE_HEADER_PATTERN.exec(content);
  return match?.[1]?.toLowerCase() as AgentId | undefined;
}

export function eventIsSensitive(event: AgentEvent): boolean {
  if (event.eventType !== "tool_request") return false;
  const actionName = event.metadata?.actionName;
  return (
    actionName === "approve_request" ||
    actionName === "update_record" ||
    actionName === "send_result" ||
    actionName === "simulate_purchase" ||
    actionName === "stage_purchase"
  );
}

export function runSecurityRules(event: AgentEvent): SecurityAssessment {
  if (
    event.sourceType !== "human" &&
    event.sourceType !== "agent" &&
    event.eventType !== "tool_request"
  ) {
    return Object.freeze({
      riskScore: 0,
      classification: "benign",
      flags: Object.freeze([]),
      ruleEvidence: Object.freeze([]),
      reason: "No human or agent instruction crossed a trust boundary.",
      shouldEscalate: false,
      source: "deterministic",
    });
  }

  const flags: string[] = [];
  const ruleEvidence: { flag: string; weight: number }[] = [];
  let score = 0;
  let classification: SecurityAssessment["classification"] = "benign";

  for (const rule of RULES) {
    if (!rule.pattern.test(event.content)) continue;
    flags.push(rule.flag);
    ruleEvidence.push({ flag: rule.flag, weight: rule.weight });
    score += rule.weight;
    if (classification === "benign" || rule.weight >= 45) {
      classification = rule.classification;
    }
  }

  const claimedIdentity = extractClaimedIdentity(event.content);
  if (
    claimedIdentity &&
    (event.sourceType !== "agent" || claimedIdentity !== event.sourceId)
  ) {
    flags.push("role_impersonation");
    ruleEvidence.push({ flag: "role_impersonation", weight: 48 });
    score += 48;
    classification = "role_impersonation";
  }

  if (
    event.sourceType === "human" &&
    /\b(?:system|developer|administrator)\s+(?:message|policy|instruction|update)\b/i.test(
      event.content,
    )
  ) {
    flags.push("human_claims_trusted_policy");
    ruleEvidence.push({ flag: "human_claims_trusted_policy", weight: 42 });
    score += 42;
    if (classification === "benign") classification = "prompt_injection";
  }

  if (eventIsSensitive(event)) {
    flags.push("sensitive_sandbox_action");
    ruleEvidence.push({ flag: "sensitive_sandbox_action", weight: 24 });
    score += 24;
    if (classification === "benign") classification = "sensitive_action";
  }

  const uniqueFlags = Object.freeze([...new Set(flags)]);
  const riskScore = clampRiskScore(score);
  const shouldEscalate = uniqueFlags.length > 0;
  const reason = shouldEscalate
    ? `Deterministic controls matched: ${uniqueFlags.join(", ")}.`
    : "No deterministic injection or trust-boundary rule matched.";

  return Object.freeze({
    riskScore,
    classification,
    flags: uniqueFlags,
    ruleEvidence: Object.freeze(ruleEvidence.map((item) => Object.freeze(item))),
    reason,
    shouldEscalate,
    source: "deterministic",
  });
}
