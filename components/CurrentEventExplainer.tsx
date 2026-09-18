import type { AgentEvent, RunMode } from "@/types/events";
import { BoltIcon, ShieldIcon } from "./Icons";
import { RiskBadge } from "./RiskBadge";

type RunPhase = "idle" | "starting" | "checkpoint" | "continuing" | "done";

function role(value?: string) {
  if (!value) return "the final output";
  return value.replaceAll("_", " ").replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

function flagSummary(event: AgentEvent) {
  if (event.flags.length === 0) return "No deterministic security rule matched this event.";
  return event.flags
    .slice(0, 3)
    .map((flag) => flag.replaceAll("_", " "))
    .join(", ");
}

function explain(event: AgentEvent, mode: RunMode) {
  const risky = event.riskScore >= 60;
  if (event.eventType === "user_input") {
    return {
      happened: "The mission entered the sandbox.",
      matters: "This immutable event is the root of every later handoff and model context.",
      next: "The Coordinator will turn it into a bounded request for Research.",
    };
  }
  if (event.eventType === "attack_injection") {
    const destination = role(event.destinationId);
    return mode === "protected"
      ? {
          happened: `A controlled attack tried to cross the gate before ${destination}.`,
          matters: `The detector scored it ${event.riskScore}/100 for ${flagSummary(event)}. ${destination} has not received it.`,
          next: "Reveal the security decision to confirm whether delivery was stopped.",
        }
      : {
          happened: `A controlled attack was delivered before ${destination}.`,
          matters: `The detector scored it ${event.riskScore}/100, but Observe only mode allows delivery so propagation is visible.`,
          next: `Watch whether ${destination} and downstream agents respond with this event in context.`,
        };
  }
  if (event.eventType === "security_alert") {
    const destination = role(event.destinationId);
    return {
      happened: `Security stopped the risky handoff before ${destination}.`,
      matters: `The attempted message is recorded for audit, but it never enters ${destination}’s model context.`,
      next: `${destination} continues from its last safe handoff.`,
    };
  }
  if (event.eventType === "tool_request") {
    return {
      happened: `${role(event.sourceId)} proposed a sandboxed action.`,
      matters: risky
        ? "The action carries high-risk context, so its ancestry matters before any decision."
        : "The action remains simulated; no external system can be changed.",
      next: "The sandbox will record whether the action is allowed, blocked, or held for review.",
    };
  }
  if (event.eventType === "tool_result") {
    return {
      happened: "The sandbox recorded the action decision.",
      matters: "This is evidence of enforcement, not a claim that an external action occurred.",
      next: "Reviewer receives the recorded result and produces the final response.",
    };
  }
  if (event.eventType === "final_output") {
    return {
      happened: "Reviewer produced the final output.",
      matters: risky
        ? "The final response was generated with exposed context; trace it to see the exact origin."
        : "The final response retained a low-risk, fully recorded ancestry.",
      next: "Inspect any event or trace the final output back to its provenance root.",
    };
  }
  return {
    happened: `${role(event.sourceId)} handed work to ${role(event.destinationId)}.`,
    matters: risky
      ? `This handoff carries risk ${event.riskScore}/100 and may influence every downstream response.`
      : "The handoff stays low risk and records the exact context used for generation.",
    next: event.destinationId
      ? `${role(event.destinationId)} will respond from the context recorded on this event.`
      : "The workflow will advance to its next bounded step.",
  };
}

type CurrentEventExplainerProps = {
  event: AgentEvent | null;
  mode: RunMode;
  phase: RunPhase;
  visibleCount: number;
  receivedCount: number;
};

export function CurrentEventExplainer({
  event,
  mode,
  phase,
  visibleCount,
  receivedCount,
}: CurrentEventExplainerProps) {
  const checkpointReady = phase === "checkpoint" && visibleCount >= receivedCount;
  const copy = event
    ? explain(event, mode)
    : {
        happened: phase === "starting" ? "The live run is starting." : "Ready to observe a run.",
        matters: "Events will appear here one at a time, separate from model execution speed.",
        next: phase === "starting" ? "The first recorded event is being buffered." : "Set a mission and run the agents.",
      };

  if (checkpointReady) {
    copy.next = "Choose Continue safely or Inject controlled attack. Nothing resumes automatically.";
  }

  const risky = Boolean(event && event.riskScore >= 60);
  return (
    <section
      className={`current-event-explainer ${risky ? "is-risky" : ""} ${checkpointReady ? "is-checkpoint" : ""}`}
      data-testid="current-event-explainer"
    >
      <div className="explainer-heading">
        <span className="explainer-icon">
          {risky ? <BoltIcon size={17} /> : <ShieldIcon size={17} />}
        </span>
        <div>
          <span className="section-label">Current event</span>
          <strong>
            {event
              ? `${visibleCount} of ${receivedCount} revealed`
              : "Waiting for the first event"}
          </strong>
        </div>
        {event && <RiskBadge level={event.riskLevel} score={event.riskScore} />}
      </div>
      <div className="explainer-facts">
        <div>
          <span>What happened</span>
          <p>{copy.happened}</p>
        </div>
        <div>
          <span>Why it matters</span>
          <p>{copy.matters}</p>
        </div>
        <div>
          <span>What happens next</span>
          <p>{copy.next}</p>
        </div>
      </div>
    </section>
  );
}
