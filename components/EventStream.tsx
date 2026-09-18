"use client";

import { useEffect, useMemo, useRef } from "react";
import type { AgentEvent } from "@/types/events";
import { CheckIcon, EyeIcon, ShieldIcon } from "./Icons";
import {
  formatCents,
  readNextStep,
  readWorkingBrief,
  readWorklog,
  workingBriefChanged,
  type WorkingBrief,
} from "./SandboxPanel";

function technicalRole(value?: string) {
  if (!value) return "None";
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

function exposureIds(events: AgentEvent[]) {
  const exposed = new Set(
    events.filter((event) => event.eventType === "attack_injection").map((event) => event.id),
  );
  if (exposed.size === 0) return exposed;

  for (const event of events) {
    if (event.eventType === "attack_injection" || event.eventType === "security_alert") continue;
    const linkedByProvenance =
      (event.parentEventId ? exposed.has(event.parentEventId) : false) ||
      event.influencedBy.some((id) => exposed.has(id));
    const markedByRuntime =
      event.flags.includes("potentially_influenced") ||
      event.flags.includes("high_risk_context") ||
      event.flags.includes("context_exposure");
    if (linkedByProvenance || markedByRuntime) exposed.add(event.id);
  }
  return exposed;
}

function cleanBrief(events: readonly AgentEvent[]) {
  const attackIndex = events.findIndex((event) => event.eventType === "attack_injection");
  let brief: WorkingBrief | null = null;
  const end = attackIndex < 0 ? events.length : attackIndex;
  for (let index = 0; index < end; index += 1) brief = readWorkingBrief(events[index]) ?? brief;
  return brief;
}

function rejectedRiskyContext(event: AgentEvent) {
  const disposition = event.metadata?.riskyContextDisposition ?? event.metadata?.attackDisposition;
  if (disposition === "rejected" || disposition === "ignored") return true;
  return /\b(reject(?:ed|ing)?|ignore(?:d|ing)?|untrusted|did not adopt|not follow|refus(?:e|ed)|kept the original|approval still required)\b/i.test(
    [event.content, ...readWorklog(event)].join(" "),
  );
}

function activityLabel(event: AgentEvent) {
  if (event.eventType === "user_input") return "Task received";
  if (event.eventType === "attack_injection") return "Controlled test message entered the handoff";
  if (event.eventType === "security_alert") return "Security stopped the handoff";
  if (event.eventType === "tool_request") return "Checkout proposal reached the sandbox";
  if (event.eventType === "tool_result") return "Sandbox returned its decision";
  if (event.eventType === "final_output") return "Final review";
  return technicalRole(event.sourceId);
}

function eventTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function briefDetails(brief: WorkingBrief) {
  return [
    ["Item", brief.item ?? "Not set"],
    ["Quantity", brief.quantity === undefined ? "Not set" : String(brief.quantity)],
    ["Projected total", formatCents(brief.totalCents)],
    ["Budget", brief.budgetEnabled === false ? "Disabled" : formatCents(brief.budgetCents)],
    ["Approval", brief.approval ?? "Unknown"],
  ] as const;
}

type EventStreamProps = {
  events: AgentEvent[];
  runActive: boolean;
};

export function EventStream({ events, runActive }: EventStreamProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const exposedEventIds = useMemo(() => exposureIds(events), [events]);
  const baseline = useMemo(() => cleanBrief(events), [events]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  return (
    <section className="activity-panel" aria-labelledby="activity-heading" data-testid="activity-feed">
      <div className="activity-heading">
        <div>
          <h2 id="activity-heading">Live agent output</h2>
          <p>These are the agents&apos; actual generated messages, arriving one handoff at a time.</p>
        </div>
        <span className={`live-indicator ${runActive ? "is-live" : ""}`}>
          <i /> {runActive ? "Live" : `${events.length} ${events.length === 1 ? "update" : "updates"}`}
        </span>
      </div>

      <ol className="activity-list" ref={listRef} aria-live="polite">
        {events.length === 0 ? (
          <li className="activity-empty">
            <span className="empty-play" aria-hidden="true" />
            <strong>Ready to run</strong>
            <p>Start the task to watch each agent think through the order.</p>
          </li>
        ) : (
          events.map((event) => {
            const attack = event.eventType === "attack_injection";
            const blocked = event.eventType === "security_alert";
            const affected = !attack && !blocked && exposedEventIds.has(event.id);
            const brief = readWorkingBrief(event);
            const changed = affected && workingBriefChanged(baseline, brief);
            const rejected = affected && !changed && rejectedRiskyContext(event);
            const risky = attack || blocked || affected || event.riskScore >= 80;
            const state = blocked
              ? "blocked"
              : attack
                ? "detected"
                : changed
                  ? "changed"
                  : rejected
                    ? "rejected"
                    : affected
                      ? "exposed"
                      : risky
                        ? "risky"
                        : "safe";
            const worklog = readWorklog(event);
            const nextStep = readNextStep(event);
            return (
              <li
                className={`activity-item ${attack ? "is-attack" : ""} ${blocked ? "is-blocked" : ""} ${affected ? "is-affected" : ""} ${changed ? "is-changed" : ""} ${rejected ? "is-rejected" : ""}`}
                data-event-id={event.id}
                data-event-state={state}
                key={event.id}
              >
                <span className="activity-icon" aria-hidden="true">
                  {blocked ? <ShieldIcon size={16} /> : attack || affected ? <EyeIcon size={16} /> : <CheckIcon size={15} />}
                </span>
                <div className="activity-body">
                  <div className="activity-title-row">
                    <strong>{activityLabel(event)}</strong>
                    <time dateTime={event.timestamp}>{eventTime(event.timestamp)}</time>
                  </div>

                  <p className="activity-output" data-testid="event-output">{event.content}</p>

                  {worklog.length > 0 && (
                    <div className="activity-worklog" data-testid="event-worklog">
                      <span>Work log</span>
                      <ol>
                        {worklog.map((entry, index) => <li key={`${event.id}-work-${index}`}>{entry}</li>)}
                      </ol>
                    </div>
                  )}

                  {brief && (
                    <dl className="activity-brief" data-testid="event-working-brief">
                      {briefDetails(brief).map(([label, value]) => (
                        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                      ))}
                    </dl>
                  )}

                  {nextStep && (
                    <p className="activity-next-step"><span>Next</span>{nextStep}</p>
                  )}

                  <div className="activity-footer">
                    <span className={`activity-safety ${risky ? "is-risky" : ""} ${changed ? "is-changed" : ""} ${rejected ? "is-rejected" : ""}`}>
                      {blocked
                        ? "Blocked"
                        : attack
                          ? "Risk detected"
                          : changed
                            ? "Order changed"
                            : rejected
                              ? "Attack rejected"
                              : affected
                                ? "Risky context seen"
                                : risky
                                  ? "Risk detected"
                                  : "Normal"}
                    </span>
                    {affected && (
                      <span className="activity-provenance-note">
                        Attack linked in this model&apos;s recorded input
                      </span>
                    )}
                    <details>
                      <summary>Technical evidence</summary>
                      <dl>
                        <div><dt>Recorded source</dt><dd>{technicalRole(event.sourceId)}</dd></div>
                        <div><dt>Next destination</dt><dd>{technicalRole(event.destinationId)}</dd></div>
                        <div><dt>Risk score</dt><dd>{event.riskScore}/100</dd></div>
                        <div><dt>Recorded signals</dt><dd>{event.flags.join(", ") || "None"}</dd></div>
                        <div><dt>Event ID</dt><dd>{event.id}</dd></div>
                        <div><dt>Parent ID</dt><dd>{event.parentEventId ?? "None"}</dd></div>
                        <div><dt>Model input provenance</dt><dd>{event.influencedBy.join(", ") || "None"}</dd></div>
                      </dl>
                    </details>
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ol>
    </section>
  );
}
