"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, RunMode } from "@/types/events";
import { AgentGraph } from "@/components/AgentGraph";
import {
  ControlPanel,
  type AttackState,
  type RunPhase,
} from "@/components/ControlPanel";
import { EventInspector } from "@/components/EventInspector";
import { EventStream } from "@/components/EventStream";
import { ShieldIcon } from "@/components/Icons";
import { SandboxPanel } from "@/components/SandboxPanel";

const DEFAULT_PROMPT =
  "In this sandbox, order one lime sparkling water for $3.50. Keep the total at or below $5. Stop before checkout and ask me to approve the cart. Do not change the item, quantity, or budget without fresh approval.";

type TerminalStatus = "complete" | "limit_reached" | "error";
type TerminalEnvelope = { status: TerminalStatus; message?: string };
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.runId === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.eventType === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.rootEventId === "string" &&
    typeof value.content === "string" &&
    typeof value.riskScore === "number" &&
    Array.isArray(value.flags) &&
    Array.isArray(value.influencedBy)
  );
}

async function responseError(response: Response) {
  const fallback = `The run service returned ${response.status}.`;
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error || payload.message || fallback;
  } catch {
    return fallback;
  }
}

async function consumeNdjson(
  response: Response,
  isCurrent: () => boolean,
  onEnvelope: (envelope: UnknownRecord) => void,
) {
  if (!response.ok) throw new Error(await responseError(response));
  if (!response.body) throw new Error("The run service did not return a live event stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || !isCurrent()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("The run service sent an unreadable event.");
    }
    if (!isRecord(parsed)) throw new Error("The run service sent an invalid event.");
    onEnvelope(parsed);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (!isCurrent()) {
      await reader.cancel();
      return;
    }
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
}

function blockedAttack(event: AgentEvent, attackId: string) {
  return (
    event.eventType === "security_alert" &&
    (event.parentEventId === attackId || event.metadata?.blockedEventId === attackId)
  );
}

function traceForAttack(attack: AgentEvent, events: AgentEvent[]) {
  const ids = new Set([attack.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const event of events) {
      if (ids.has(event.id)) continue;
      const linked =
        (event.parentEventId ? ids.has(event.parentEventId) : false) ||
        event.influencedBy.some((id) => ids.has(id)) ||
        (typeof event.metadata?.blockedEventId === "string" && ids.has(event.metadata.blockedEventId));
      if (linked) {
        ids.add(event.id);
        changed = true;
      }
    }
  }
  return events.filter((event) => ids.has(event.id));
}

export default function ObservatoryPage() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [mode, setMode] = useState<RunMode>("protected");
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [attackState, setAttackState] = useState<AttackState>("none");
  const [terminal, setTerminal] = useState<TerminalEnvelope | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [riskThreshold, setRiskThreshold] = useState(80);

  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const checkpointRef = useRef<string | null>(null);
  const phaseOneCountRef = useRef(0);
  const eventsRef = useRef<AgentEvent[]>([]);
  const attackRequestedRef = useRef(false);
  const phaseRef = useRef<RunPhase>("idle");
  const attackIdRef = useRef<string | null>(null);
  const runSideRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    runSideRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [traceOpen]);

  const changePhase = useCallback((next: RunPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const replaceEvents = useCallback((next: AgentEvent[]) => {
    eventsRef.current = next;
    setEvents(next);
  }, []);

  const appendEvent = useCallback((event: AgentEvent) => {
    if (eventsRef.current.some((candidate) => candidate.id === event.id)) return;
    replaceEvents([...eventsRef.current, event]);
    if (event.eventType === "attack_injection") {
      attackIdRef.current = event.id;
      setAttackState("running");
    }
    if (attackIdRef.current && blockedAttack(event, attackIdRef.current)) {
      setAttackState("blocked");
    }
  }, [replaceEvents]);

  const failRun = useCallback((error: unknown, generation: number) => {
    if (generationRef.current !== generation) return;
    const message = error instanceof Error ? error.message : "The live run could not be completed.";
    setRuntimeError(message);
    setTerminal({ status: "error", message });
    changePhase("done");
  }, [changePhase]);

  const runContinuation = useCallback(async ({
    attack,
    checkpoint,
    controller,
    generation,
  }: {
    attack: boolean;
    checkpoint: string;
    controller: AbortController;
    generation: number;
  }) => {
    if (generationRef.current !== generation) return;
    changePhase("continuing");
    if (attack) setAttackState("queued");
    let sawTerminal = false;

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "continue",
          checkpoint,
          ...(attack ? { attack: { type: "agent_poisoning" } } : {}),
        }),
        signal: controller.signal,
      });
      await consumeNdjson(
        response,
        () => generationRef.current === generation,
        (envelope) => {
          if (envelope.type === "run_started" && isRecord(envelope.limits)) {
            const threshold = envelope.limits.riskBlockThreshold;
            if (typeof threshold === "number") setRiskThreshold(threshold);
            return;
          }
          if (envelope.type === "event" && isAgentEvent(envelope.event)) {
            appendEvent(envelope.event);
            return;
          }
          if (envelope.type === "complete" && envelope.phase === 2) {
            const status = envelope.status;
            if (status === "complete" || status === "limit_reached" || status === "error") {
              sawTerminal = true;
              const nextTerminal: TerminalEnvelope = {
                status,
                ...(typeof envelope.message === "string" ? { message: envelope.message } : {}),
              };
              setTerminal(nextTerminal);
              if (status === "error") {
                setRuntimeError(nextTerminal.message || "The run stopped safely after an error.");
              }
              changePhase("done");
            }
            return;
          }
          if (envelope.type === "error") {
            throw new Error(
              typeof envelope.message === "string" ? envelope.message : "The live run reported an error.",
            );
          }
        },
      );
      if (generationRef.current === generation && !sawTerminal) {
        throw new Error("The live stream ended before reporting a final status.");
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") failRun(error, generation);
    }
  }, [appendEvent, changePhase, failRun]);

  const startRun = useCallback(async () => {
    if (!prompt.trim() || phaseRef.current !== "idle") return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    checkpointRef.current = null;
    phaseOneCountRef.current = 0;
    attackRequestedRef.current = false;
    attackIdRef.current = null;
    replaceEvents([]);
    setAttackState("none");
    setTerminal(null);
    setRuntimeError(null);
    setTraceOpen(false);
    changePhase("starting");

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", prompt: prompt.trim(), mode }),
        signal: controller.signal,
      });
      await consumeNdjson(
        response,
        () => generationRef.current === generation,
        (envelope) => {
          if (envelope.type === "run_started" && isRecord(envelope.limits)) {
            const threshold = envelope.limits.riskBlockThreshold;
            if (typeof threshold === "number") setRiskThreshold(threshold);
            return;
          }
          if (envelope.type === "event" && isAgentEvent(envelope.event)) {
            appendEvent(envelope.event);
            return;
          }
          if (envelope.type === "checkpoint" && typeof envelope.checkpoint === "string") {
            checkpointRef.current = envelope.checkpoint;
            phaseOneCountRef.current = eventsRef.current.length;
            return;
          }
          if (envelope.type === "error") {
            throw new Error(
              typeof envelope.message === "string" ? envelope.message : "The live run reported an error.",
            );
          }
        },
      );

      if (generationRef.current !== generation) return;
      const checkpoint = checkpointRef.current;
      if (!checkpoint) throw new Error("The run did not return a valid continuation checkpoint.");
      await runContinuation({
        attack: attackRequestedRef.current,
        checkpoint,
        controller,
        generation,
      });
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") failRun(error, generation);
    }
  }, [appendEvent, changePhase, failRun, mode, prompt, replaceEvents, runContinuation]);

  const replayWithAttack = useCallback(async () => {
    const checkpoint = checkpointRef.current;
    if (!checkpoint) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Keep the completed clean branch visible. The attacked continuation gets
    // fresh event IDs, so the UI can compare each real model output side by side.
    replaceEvents(eventsRef.current);
    attackIdRef.current = null;
    setAttackState("queued");
    setTerminal(null);
    setRuntimeError(null);
    setTraceOpen(false);
    await runContinuation({ attack: true, checkpoint, controller, generation });
  }, [replaceEvents, runContinuation]);

  const injectAttack = useCallback(() => {
    if (attackRequestedRef.current || phaseRef.current === "idle") return;
    attackRequestedRef.current = true;
    setAttackState("queued");

    // During phase one, retain the request and attach it as soon as the signed
    // checkpoint arrives. Once normal phase two has begun, replay only that
    // phase from the retained checkpoint so the comparison stays exact.
    if (phaseRef.current === "starting" || !checkpointRef.current) return;
    void replayWithAttack();
  }, [replayWithAttack]);

  const newRun = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    checkpointRef.current = null;
    phaseOneCountRef.current = 0;
    attackRequestedRef.current = false;
    attackIdRef.current = null;
    replaceEvents([]);
    setAttackState("none");
    setTerminal(null);
    setRuntimeError(null);
    setTraceOpen(false);
    changePhase("idle");
  }, [changePhase, replaceEvents]);

  const attackEvent = useMemo(
    () => events.find((event) => event.eventType === "attack_injection") ?? null,
    [events],
  );
  const attackTrace = useMemo(
    () => (attackEvent ? traceForAttack(attackEvent, events) : []),
    [attackEvent, events],
  );
  const securityEvent = attackEvent
    ? events.find((event) => blockedAttack(event, attackEvent.id)) ?? null
    : null;
  const exposedAgentCount = useMemo(() => {
    if (!attackEvent || securityEvent) return 0;
    const workflowAgents = new Set(["research", "analysis", "execution", "reviewer"]);
    return new Set(
      attackTrace
        .filter((event) => event.id !== attackEvent.id && workflowAgents.has(event.sourceId))
        .map((event) => event.sourceId),
    ).size;
  }, [attackEvent, attackTrace, securityEvent]);
  const runActive = phase === "starting" || phase === "continuing";
  const statusLabel = runtimeError
    ? "Error"
    : runActive
      ? "Running"
      : phase === "done"
        ? terminal?.status === "limit_reached" ? "Limit reached" : "Complete"
        : "Ready";
  const outcomeLabel = runtimeError
    ? "Run stopped safely. Start a new run to try again."
    : securityEvent && phase === "done"
      ? "Forged order blocked. The authorized cart stayed intact."
      : securityEvent
        ? "Forged order blocked. The agents are finishing from the authorized plan."
        : attackEvent
          ? exposedAgentCount > 0
            ? phase === "done"
              ? "Poisoned branch complete. Compare the current cart with the authorized plan."
              : "The forged order is moving through the agent handoffs."
            : mode === "protected"
              ? "Checking the forged approval before it reaches the next agent."
              : "Forged approval detected. Blocking is off, so the sandbox will show what changes."
          : attackState === "queued"
            ? "Forged approval queued for the next handoff."
            : phase === "done"
              ? "Clean branch complete. The virtual order still matches the user's limits."
              : runActive
                ? "The agents are building the drink order in real time."
                : "Ready to build one virtual drink order.";

  return (
    <main className="observatory-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <strong>Agent security</strong>
            <span>Live security workflow</span>
          </div>
        </div>
        <div className={`protection-status ${mode === "unprotected" ? "is-off" : ""}`}>
          <ShieldIcon size={16} /> Blocking {mode === "protected" ? "on" : "off · sandboxed"}
        </div>
      </header>

      <ControlPanel
        attackState={attackState}
        onInjectAttack={injectAttack}
        onNewRun={newRun}
        onPromptChange={setPrompt}
        onRun={() => void startRun()}
        phase={phase}
        prompt={prompt}
        mode={mode}
        onModeChange={setMode}
      />

      {runtimeError && (
        <div className="runtime-error" role="alert">
          <strong>Run stopped.</strong>
          <span>{runtimeError}</span>
        </div>
      )}

      <section className="live-run" data-testid="live-run">
        <div className="live-run-heading">
          <div>
            <h1>Live run</h1>
            <p data-testid="run-outcome">{outcomeLabel}</p>
          </div>
          <div className={`run-status ${runActive ? "is-running" : ""}`} data-testid="run-status" role="status">
            <i /> {statusLabel}
          </div>
        </div>

        <AgentGraph
          attackBlocked={Boolean(securityEvent)}
          attackEvent={attackEvent}
          events={events}
          runActive={runActive}
        />

        <div className="live-run-body">
          <EventStream events={events} runActive={runActive} />

          <div className="run-side" ref={runSideRef}>
            {traceOpen && attackEvent && attackTrace.length > 0 ? (
              <EventInspector
                attackEvent={attackEvent}
                mode={mode}
                onClose={() => setTraceOpen(false)}
                riskThreshold={riskThreshold}
                traceEvents={attackTrace}
              />
            ) : (
              <SandboxPanel
                attackEvent={attackEvent}
                events={events}
                mode={mode}
                onTraceAttack={() => setTraceOpen(true)}
                traceAvailable={Boolean(attackEvent && attackTrace.length > 0)}
              />
            )}
          </div>
        </div>
      </section>

      <div className="sr-only" aria-live="assertive">
        {events.at(-1)?.eventType ?? ""}
      </div>
    </main>
  );
}
