import { MAX_CONTEXT_EVENTS_PER_CALL } from "@/lib/config";
import type { AgentEvent } from "@/types/events";

const CONTEXT_EVENT_TYPES = new Set([
  "user_input",
  "agent_message",
  "tool_request",
  "tool_result",
  "attack_injection",
  "final_output",
]);

export function indexEvents(
  events: readonly AgentEvent[],
): ReadonlyMap<string, AgentEvent> {
  return new Map(events.map((event) => [event.id, event]));
}

/** Immediate-parent trace, returned from the root/origin to the selected event. */
export function traceToOrigin(
  events: readonly AgentEvent[],
  eventId: string,
): readonly AgentEvent[] {
  const byId = indexEvents(events);
  const reversed: AgentEvent[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(eventId);

  while (cursor && !seen.has(cursor.id)) {
    reversed.push(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentEventId
      ? byId.get(cursor.parentEventId)
      : undefined;
  }

  return Object.freeze(reversed.reverse());
}

/**
 * Full recorded ancestry: parent links plus the exact context IDs. This is
 * recorded influence, not speculative semantic causality.
 */
export function getProvenanceTrace(
  events: readonly AgentEvent[],
  eventId: string,
): readonly AgentEvent[] {
  const byId = indexEvents(events);
  const included = new Set<string>();
  const visit = (id: string): void => {
    if (included.has(id)) return;
    const event = byId.get(id);
    if (!event) return;
    included.add(id);
    if (event.parentEventId) visit(event.parentEventId);
    for (const influenceId of event.influencedBy) visit(influenceId);
  };
  visit(eventId);
  return Object.freeze(events.filter((event) => included.has(event.id)));
}

export interface ContextSelectionOptions {
  readonly seedEventIds?: readonly string[];
  readonly blockedEventIds?: ReadonlySet<string> | readonly string[];
  readonly maxEvents?: number;
}

/**
 * Selects a bounded, ordered context from recorded ancestry. When pruning is
 * required it always retains the current event and highest-risk ancestry, then
 * fills with the most recent events. Returned order is chronological.
 */
export function getContextForAgent(
  events: readonly AgentEvent[],
  incomingEvent: AgentEvent,
  options: ContextSelectionOptions = {},
): readonly AgentEvent[] {
  const byId = indexEvents(events);
  const blocked = new Set(options.blockedEventIds ?? []);
  const included = new Set<string>();
  const visit = (id: string): void => {
    if (included.has(id) || blocked.has(id)) return;
    const event = byId.get(id);
    if (!event || !CONTEXT_EVENT_TYPES.has(event.eventType)) return;
    included.add(id);
    if (event.parentEventId) visit(event.parentEventId);
    for (const influenceId of event.influencedBy) visit(influenceId);
  };

  for (const seed of options.seedEventIds ?? []) visit(seed);
  visit(incomingEvent.id);

  const candidates = events.filter(
    (event) => included.has(event.id) && !blocked.has(event.id),
  );
  const maxEvents = Math.max(
    1,
    Math.min(
      options.maxEvents ?? MAX_CONTEXT_EVENTS_PER_CALL,
      MAX_CONTEXT_EVENTS_PER_CALL,
    ),
  );
  if (candidates.length <= maxEvents) return Object.freeze(candidates);

  const chosen = new Set<string>([incomingEvent.id]);
  const riskOrdered = [...candidates].sort(
    (left, right) => right.riskScore - left.riskScore,
  );
  for (const event of riskOrdered) {
    if (chosen.size >= Math.min(2, maxEvents)) break;
    chosen.add(event.id);
  }
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (chosen.size >= maxEvents) break;
    chosen.add(candidates[index].id);
  }

  return Object.freeze(candidates.filter((event) => chosen.has(event.id)));
}

export const buildProvenanceTrace = getProvenanceTrace;
