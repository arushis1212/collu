import { BoltIcon, PlayIcon, ResetIcon, ShieldIcon } from "./Icons";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
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
    <section className="task-control command-panel" aria-labelledby="task-label" data-slot="command-panel">
      <div className="task-copy">
        <span className="scenario-label">Isolated evaluation</span>
        <label id="task-label" htmlFor="task-input">Sandbox command</label>
        <span className="command-panel-description">
          Run the authorized order, then introduce one controlled forged approval.
        </span>
      </div>

      <div className="task-entry">
        <Textarea
          aria-label="Task"
          className="task-prompt-input"
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
            <Button
              className="button-primary"
              disabled={!prompt.trim()}
              onClick={onRun}
              title="Run sandbox"
              variant="primary"
            >
              <PlayIcon size={17} />
              <span className="sidebar-control-copy">Run sandbox</span>
            </Button>
          ) : (
            <>
              <Button
                className="button-attack"
                disabled={!canInject}
                onClick={onInjectAttack}
                data-testid="attack-control"
                title={completedCleanRun ? "Replay with forged approval" : "Inject forged approval"}
                variant="attack"
              >
                <BoltIcon size={17} />
                <span className="sidebar-control-copy">
                  {attackState === "none"
                    ? completedCleanRun ? "Replay with forged approval" : "Inject forged approval"
                    : attackState === "queued"
                      ? "Forged approval queued"
                      : attackState === "running"
                        ? phase === "done" ? "Attack replay complete" : "Poisoned branch running"
                        : "Forged approval blocked"}
                </span>
              </Button>
              <Button
                className="button-secondary"
                onClick={onNewRun}
                title="New run"
                variant="secondary"
              >
                <ResetIcon size={16} />
                <span className="sidebar-control-copy">New run</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="protection-control" data-testid="protection-control">
        <div className="protection-control-heading">
          <ShieldIcon size={15} />
          <span className="sidebar-control-copy">Message protection</span>
          <i aria-hidden="true" className={mode === "protected" ? "is-on" : "is-off"} />
        </div>
        <div aria-label="Protection mode" className="protection-toggle" role="group">
          <Button
            aria-pressed={mode === "protected"}
            className={mode === "protected" ? "is-selected" : ""}
            disabled={!idle}
            onClick={() => onModeChange("protected")}
            size="sm"
            variant="ghost"
          >
            <span className="control-long-label">Protection </span>on
          </Button>
          <Button
            aria-pressed={mode === "unprotected"}
            className={mode === "unprotected" ? "is-selected" : ""}
            disabled={!idle}
            onClick={() => onModeChange("unprotected")}
            size="sm"
            variant="ghost"
          >
            <span className="control-long-label">Protection </span>off
          </Button>
        </div>
        <p className="sidebar-control-copy">{mode === "protected"
          ? "Stops a score of 80+ before delivery."
          : "Allows delivery so you can trace exposure."}</p>
        <small className="sidebar-control-copy">No checkout. All tools stay sandboxed.</small>
      </div>
    </section>
  );
}
