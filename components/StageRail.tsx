import type { AgentEvent, RunMode } from "@/types/events";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "./Icons";

const STAGES = [
  { id: "mission", label: "Mission" },
  { id: "coordinator", label: "Coordinator" },
  { id: "security", label: "Security gate" },
  { id: "research", label: "Research" },
  { id: "analysis", label: "Analysis" },
  { id: "execution", label: "Execution" },
  { id: "review", label: "Review" },
] as const;

type RunPhase = "idle" | "starting" | "checkpoint" | "continuing" | "done";
export type PlaybackSpeed = 0.5 | 1 | 2;

function stageForEvent(event: AgentEvent): number {
  if (event.eventType === "user_input") return 0;
  if (event.eventType === "attack_injection" || event.eventType === "security_alert") return 2;
  if (event.sourceId === "coordinator") return 1;
  if (event.sourceId === "research") return 3;
  if (event.sourceId === "analysis") return 4;
  if (
    event.sourceId === "execution" ||
    event.sourceId === "sandbox" ||
    event.eventType === "tool_request" ||
    event.eventType === "tool_result"
  ) return 5;
  if (event.sourceId === "reviewer" || event.eventType === "final_output") return 6;
  return 0;
}

type StageRailProps = {
  events: AgentEvent[];
  mode: RunMode;
  phase: RunPhase;
  isPlaying: boolean;
  visibleCount: number;
  receivedCount: number;
  speed: PlaybackSpeed;
  onPrevious: () => void;
  onTogglePlayback: () => void;
  onNext: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
};

export function StageRail({
  events,
  mode,
  phase,
  isPlaying,
  visibleCount,
  receivedCount,
  speed,
  onPrevious,
  onTogglePlayback,
  onNext,
  onSpeedChange,
}: StageRailProps) {
  const latest = events.at(-1);
  const currentStage = latest ? stageForEvent(latest) : -1;
  const waitingAtGate = phase === "checkpoint" && visibleCount >= receivedCount;
  const hasAttack = events.some((event) => event.eventType === "attack_injection");
  const hasSecurityAlert = events.some((event) => event.eventType === "security_alert");
  const canPlay = visibleCount < receivedCount || phase === "starting" || phase === "continuing";
  const queuedCount = Math.max(0, receivedCount - visibleCount);

  return (
    <section className="stage-and-playback" data-testid="mission-stage-rail">
      <ol className="stage-rail" aria-label="Mission progress">
        {STAGES.map((stage, index) => {
          let state = "waiting";
          if (index < currentStage) state = "complete";
          if (index === currentStage) state = "active";
          if (phase === "done" && index <= currentStage) state = "complete";
          if (index === 2 && waitingAtGate) state = "active";
          if (index === 2 && hasSecurityAlert && mode === "protected") {
            state = "contained";
          }
          if (index === 2 && hasAttack && mode === "unprotected") {
            state = "observed";
          }
          return (
            <li data-stage-state={state} key={stage.id}>
              <span className="stage-marker">{index + 1}</span>
              <span>{stage.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="playback-controls" aria-label="Event playback controls" role="group">
        <span className="buffer-readout" aria-live="polite">
          {queuedCount > 0 ? `${queuedCount} queued` : visibleCount > 0 ? "Caught up" : "Waiting"}
        </span>
        <div className="transport-controls" aria-label="Timeline navigation" role="group">
          <button aria-label="Previous" disabled={visibleCount <= 1} onClick={onPrevious} type="button">
            <PreviousIcon size={16} />
          </button>
          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            className="play-toggle"
            disabled={!isPlaying && !canPlay}
            onClick={onTogglePlayback}
            type="button"
          >
            {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>
          <button aria-label="Next" disabled={visibleCount >= receivedCount} onClick={onNext} type="button">
            <NextIcon size={16} />
          </button>
        </div>
        <div className="speed-control" aria-label="Playback speed" role="group">
          {([0.5, 1, 2] as const).map((value) => (
            <button
              aria-label={`${value}x speed`}
              aria-pressed={speed === value}
              className={speed === value ? "selected" : ""}
              key={value}
              onClick={() => onSpeedChange(value)}
              type="button"
            >
              {value}×
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
