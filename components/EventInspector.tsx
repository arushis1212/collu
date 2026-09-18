import type { AgentEvent, RunMode } from "@/types/events";
import { CloseIcon, ShieldIcon } from "./Icons";
import { formatCents, readWorkingBrief, readWorklog } from "./SandboxPanel";

const FLAG_EXPLANATIONS: Readonly<Record<string, string>> = {
  instruction_override: "Tried to replace earlier instructions",
  system_instruction_override: "Tried to override system instructions",
  untrusted_system_policy: "Presented untrusted text as a system update",
  security_bypass: "Tried to bypass a security or approval control",
  approval_bypass: "Said required reviewer approval no longer applied",
  unverified_approval_claim: "Claimed approval without trusted evidence",
  concealment_request: "Asked the workflow to conceal the instruction",
  propagation_request: "Asked agents to propagate the instruction downstream",
  trust_boundary_crossing: "Claimed a trusted policy at an agent boundary",
  role_impersonation: "Claimed a different agent identity",
  human_claims_trusted_policy: "Presented human input as trusted system policy",
  prompt_injection: "Attempted to redirect the workflow's instructions",
  policy_bypass: "Attempted to remove a required control",
};

const NON_DETECTION_FLAGS = new Set([
  "blocked_by_policy",
  "context_exposure",
  "potentially_influenced",
  "high_risk_context",
  "security_judge_unavailable",
  "security_judge_failed",
]);

function readableName(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return "None recorded";
  const workflowNames: Record<string, string> = {
    human: "Human",
    coordinator: "Plan order",
    research: "Find a drink",
    analysis: "Check budget",
    execution: "Prepare checkout",
    reviewer: "Final review",
    sandbox: "Sandbox",
    security: "Security layer",
  };
  return workflowNames[value] ?? value.replaceAll("_", " ").replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

function traceLabel(event: AgentEvent) {
  if (event.eventType === "attack_injection") return "Poisoned handoff inserted";
  if (event.eventType === "security_alert") return "Security decision";
  if (event.eventType === "tool_request") return "Checkout request";
  if (event.eventType === "tool_result") return "Sandbox decision";
  if (event.eventType === "final_output" || event.sourceId === "reviewer") return "Final review";
  if (event.sourceId === "research") return "Find a drink";
  if (event.sourceId === "analysis") return "Check budget";
  if (event.sourceId === "execution") return "Prepare checkout";
  return readableName(event.sourceId);
}

function traceContext(event: AgentEvent, threshold: number) {
  if (event.eventType === "attack_injection") {
    return "Controlled fixture added at this handoff.";
  }
  if (event.eventType === "security_alert") {
    return `${event.riskScore}/100 met the ${threshold}/100 block line. The receiving agent never saw it.`;
  }
  return "The attack event appears in this model call's recorded input provenance.";
}

function traceState(event: AgentEvent) {
  if (event.eventType === "security_alert") return "Blocked";
  if (event.eventType === "attack_injection") return "Detected";
  return event.flags.some((flag) =>
    flag === "potentially_influenced" || flag === "high_risk_context" || flag === "context_exposure",
  ) ? "Risky context" : "Recorded";
}

function detectorExplanation(source: unknown, flags: readonly string[]) {
  if (flags.includes("security_judge_unavailable")) {
    return "Deterministic text and identity rules flagged the message first. The optional advisory model was unavailable, so the rule based score was retained.";
  }
  if (flags.includes("security_judge_failed")) {
    return "Deterministic text and identity rules flagged the message first. The optional advisory review failed, so the rule based score was retained.";
  }
  if (source === "combined") {
    return "Deterministic text and identity rules flagged the message first. An advisory model then reviewed it, but could not lower the rule based score.";
  }
  if (source === "judge") {
    return "An advisory security model classified the message. The event keeps that assessment with the trace.";
  }
  return "Local text and identity rules produced this score before the message crossed into the next agent.";
}

function storedRuleEvidence(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    return typeof candidate.flag === "string" && typeof candidate.weight === "number"
      ? [{ flag: candidate.flag, weight: candidate.weight }]
      : [];
  });
}

type EventInspectorProps = {
  attackEvent: AgentEvent;
  traceEvents: AgentEvent[];
  mode: RunMode;
  riskThreshold?: number;
  onClose: () => void;
};

export function EventInspector({
  attackEvent,
  traceEvents,
  mode,
  riskThreshold = 80,
  onClose,
}: EventInspectorProps) {
  const securityEvent = traceEvents.find((event) => event.eventType === "security_alert");
  const metadataThreshold = securityEvent?.metadata?.threshold;
  const threshold = typeof metadataThreshold === "number" ? metadataThreshold : riskThreshold;
  const blocked = Boolean(securityEvent);
  const exposedEvents = traceEvents.filter(
    (event) => event.eventType !== "attack_injection" && event.eventType !== "security_alert",
  );
  const source = attackEvent.metadata?.actualSourceId ?? attackEvent.sourceId;
  const claimedSource = attackEvent.metadata?.claimedSourceId;
  const assessmentSource = attackEvent.metadata?.securityAssessmentSource;
  const assessmentReason = attackEvent.metadata?.securityReason;
  const classification = attackEvent.metadata?.securityClassification;
  const signals = attackEvent.flags.filter((flag) => !NON_DETECTION_FLAGS.has(flag));
  const ruleEvidence = storedRuleEvidence(attackEvent.metadata?.securityRuleEvidence);
  const weightByFlag = new Map(ruleEvidence.map((item) => [item.flag, item.weight]));
  const rawRuleScore = ruleEvidence.reduce((total, item) => total + item.weight, 0);
  const title = blocked
    ? "The attack stopped here"
    : mode === "unprotected"
      ? "Watch the poisoned order move"
      : "Why the attack was detected";
  const summary = blocked
    ? "The poisoned handoff was blocked before Find a drink received it. The workflow continued from the last trusted order state."
    : mode === "unprotected"
      ? `Blocking stayed off for this sandbox test. Below are the actual outputs from ${exposedEvents.length} attack linked ${exposedEvents.length === 1 ? "event" : "events"}.`
      : "The risky handoff has been detected and is awaiting its enforcement decision.";
  const decision = blocked
    ? "Blocked before delivery"
    : mode === "unprotected"
      ? "Delivered to sandboxed agents because blocking was off"
      : "Protection decision pending";

  return (
    <aside className={`trace-panel ${blocked ? "is-blocked" : "is-exposed"}`} aria-labelledby="trace-heading" data-testid="attack-trace">
      <div className="trace-heading">
        <div>
          <span className="trace-kicker"><ShieldIcon size={15} /> Recorded trace</span>
          <h2 id="trace-heading">{title}</h2>
        </div>
        <button aria-label="Close attack trace" onClick={onClose} type="button">
          <CloseIcon size={17} />
        </button>
      </div>

      <p className="trace-summary">{summary}</p>

      <section className="trace-observation" aria-labelledby="trace-observation-heading">
        <h3 id="trace-observation-heading">What each step actually said</h3>
        <ol className="trace-path">
          {traceEvents.map((event, index) => {
            const worklog = readWorklog(event);
            const brief = readWorkingBrief(event);
            return (
              <li
                className={event.eventType === "security_alert" ? "is-blocked" : event.eventType === "attack_injection" ? "is-attack" : "is-exposed"}
                data-trace-event={event.id}
                key={event.id}
              >
                <span>{index + 1}</span>
                <div>
                  <div className="trace-event-heading">
                    <strong>{traceLabel(event)}</strong>
                    <b>{traceState(event)}</b>
                  </div>
                  <blockquote className="trace-event-output" data-testid="trace-event-output">
                    {event.content}
                  </blockquote>
                  {worklog.length > 0 && (
                    <ol className="trace-event-worklog">
                      {worklog.map((entry, workIndex) => (
                        <li key={`${event.id}-trace-work-${workIndex}`}>{entry}</li>
                      ))}
                    </ol>
                  )}
                  {brief && (
                    <div className="trace-brief-snapshot" data-testid="trace-working-brief">
                      <span>{brief.quantity ?? "?"} × {brief.item ?? "Unspecified item"}</span>
                      <span>{formatCents(brief.totalCents)} projected</span>
                      <span>{brief.budgetEnabled === false ? "Budget disabled" : `${formatCents(brief.budgetCents)} budget`}</span>
                      <span>Approval: {brief.approval ?? "unknown"}</span>
                    </div>
                  )}
                  <p className="trace-event-provenance">{traceContext(event, threshold)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="detection-evidence" aria-labelledby="detection-heading" data-testid="detection-evidence">
        <h3 id="detection-heading">Why security flagged the handoff</h3>
        <div className="detection-ingress">
          <strong>How it appeared</strong>
          <p>
            You clicked Inject forged approval. COLLU inserted a predefined, controlled sandbox
            fixture at the handoff into Find a drink; it did not come from the task or a live attacker.
          </p>
        </div>
        <div className="trace-message">
          <span>Exact injected message</span>
          <p>{attackEvent.content}</p>
        </div>
        <p>
          The runtime recorded <strong>{readableName(source)}</strong> as the sender,
          {claimedSource ? <> while the text claimed <strong>{readableName(claimedSource)}</strong>,</> : null}
          {" "}and targeted <strong>{readableName(attackEvent.destinationId)}</strong>.
        </p>

        <dl className="detection-route">
          <div><dt>Actual source</dt><dd>{readableName(source)}</dd></div>
          <div><dt>Claimed source</dt><dd>{readableName(claimedSource)}</dd></div>
          <div><dt>Target</dt><dd>{readableName(attackEvent.destinationId)}</dd></div>
          <div><dt>Decision</dt><dd>{decision}</dd></div>
        </dl>

        <div className="detection-score">
          <div>
            <strong>{attackEvent.riskScore}/100 risk</strong>
            <span>{threshold}/100 blocking threshold</span>
          </div>
          <meter min={0} max={100} low={40} high={threshold} optimum={0} value={attackEvent.riskScore}>
            {attackEvent.riskScore} out of 100
          </meter>
        </div>

        <div className="detection-signals">
          <strong>{signals.length} recorded {signals.length === 1 ? "signal" : "signals"}</strong>
          {signals.length > 0 ? (
            <ul>
              {signals.map((flag) => (
                <li key={flag}>
                  <span>{FLAG_EXPLANATIONS[flag] ?? readableName(flag)}</span>
                  {weightByFlag.has(flag) ? <b>+{weightByFlag.get(flag)}</b> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>No named deterministic signal was stored for this event.</p>
          )}
          {rawRuleScore > 0 && (
            <p className="detection-math">
              Deterministic rule total: {rawRuleScore} points, capped at 100. Blocking begins at {threshold}.
            </p>
          )}
        </div>

        <p className="detector-method">{detectorExplanation(assessmentSource, attackEvent.flags)}</p>
      </section>

      <p className="trace-provenance-note">
        “Risky context” means the attack appears in that model call&apos;s recorded input. The output above shows whether the agent&apos;s plan then changed; it does not claim an external purchase occurred.
      </p>

      <details className="trace-technical">
        <summary>Technical evidence</summary>
        <dl>
          <div><dt>Attack event</dt><dd>{attackEvent.id}</dd></div>
          <div><dt>Recorded sender</dt><dd>{attackEvent.sourceId}</dd></div>
          <div><dt>Claimed sender</dt><dd>{String(claimedSource ?? "None")}</dd></div>
          <div><dt>Destination</dt><dd>{attackEvent.destinationId ?? "None"}</dd></div>
          <div><dt>Classification</dt><dd>{String(classification ?? "Not recorded")}</dd></div>
          <div><dt>Assessment source</dt><dd>{String(assessmentSource ?? "Not recorded")}</dd></div>
          <div><dt>Security event</dt><dd>{securityEvent?.id ?? "None"}</dd></div>
          <div><dt>Blocked event</dt><dd>{String(securityEvent?.metadata?.blockedEventId ?? "None")}</dd></div>
          <div className="technical-wide"><dt>Stored assessment</dt><dd>{String(assessmentReason ?? "Not recorded")}</dd></div>
        </dl>
      </details>
    </aside>
  );
}
