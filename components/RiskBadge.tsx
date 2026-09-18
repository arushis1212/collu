import type { AgentEvent } from "@/types/events";

type RiskBadgeProps = {
  level: AgentEvent["riskLevel"];
  score?: number;
  compact?: boolean;
};

export function RiskBadge({ level, score, compact = false }: RiskBadgeProps) {
  return (
    <span className={`risk-badge risk-${level}`} data-risk-level={level}>
      <span className="risk-badge-dot" />
      {compact ? score ?? level : `${level}${score === undefined ? "" : ` · ${score}`}`}
    </span>
  );
}
