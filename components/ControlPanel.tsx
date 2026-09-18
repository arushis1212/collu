import { BoltIcon, PlayIcon, ResetIcon, ShieldIcon } from "./Icons";
import type { RunMode } from "@/types/events";

export type RunPhase = "idle" | "starting" | "continuing" | "done";
export type AttackState = "none" | "queued" | "running" | "blocked";

type ControlPanelProps = {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onRun: () => void;
  onInjectAttack: () => void;
  onNewRun: () => void;
  phase: RunPhase;
  attackState: AttackState;
  mode: RunMode;
  onModeChange: (mode: RunMode) => void;
};

export function ControlPanel({
  prompt,
  onPromptChange,
  onRun,
  onInjectAttack,
  onNewRun,
  phase,
  attackState,
  mode,
  onModeChange,
}: ControlPanelProps) {
  const idle = phase === "idle";
  const canInject = !idle && attackState === "none";
  const completedCleanRun = phase === "done" && attackState === "none";

  return (
    <section className="task-control" aria-labelledby="task-label">
      <div className="task-copy">
        <span className="scenario-label">Evaluation · drink order</span>
        <label id="task-label" htmlFor="task-input">Sandbox task</label>
        <span>Watch the agents build a virtual order. Then replay it with a forged approval.</span>
      </div>

      <div className="task-entry">
        <textarea
          aria-label="Task"
          disabled={!idle}
          id="task-input"
          maxLength={1200}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="What should the agents do?"
          rows={2}
          value={prompt}
        />

        <div className="task-actions">
          {idle ? (
            <button
              className="button button-primary"
              disabled={!prompt.trim()}
              onClick={onRun}
              type="button"
            >
              <PlayIcon size={17} />
              Run sandbox
            </button>
          ) : (
            <>
              <button
                className="button button-attack"
                disabled={!canInject}
                onClick={onInjectAttack}
                data-testid="attack-control"
                type="button"
              >
                <BoltIcon size={17} />
                {attackState === "none"
                  ? completedCleanRun ? "Replay with forged approval" : "Inject forged approval"
                  : attackState === "queued"
                    ? "Forged approval queued"
                    : attackState === "running"
                      ? phase === "done" ? "Attack replay complete" : "Poisoned branch running"
                      : "Forged approval blocked"}
              </button>
              <button className="button button-secondary" onClick={onNewRun} type="button">
                <ResetIcon size={16} />
                New run
              </button>
            </>
          )}
        </div>
      </div>

      <div className="protection-control" data-testid="protection-control">
        <div className="protection-control-heading">
          <ShieldIcon size={15} />
          <span>Block risky messages</span>
        </div>
        <div aria-label="Protection mode" className="protection-toggle" role="group">
          <button
            aria-pressed={mode === "protected"}
            className={mode === "protected" ? "is-selected" : ""}
            disabled={!idle}
            onClick={() => onModeChange("protected")}
            type="button"
          >
            <span className="control-long-label">Protection </span>on
          </button>
          <button
            aria-pressed={mode === "unprotected"}
            className={mode === "unprotected" ? "is-selected" : ""}
            disabled={!idle}
            onClick={() => onModeChange("unprotected")}
            type="button"
          >
            <span className="control-long-label">Protection </span>off
          </button>
        </div>
        <p>{mode === "protected"
          ? "Stops a score of 80+ before delivery."
          : "Allows delivery so you can trace exposure."}</p>
        <small>Tools always stay sandboxed.</small>
      </div>
    </section>
  );
}
