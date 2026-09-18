import type { RunLimits } from "@/types/events";

export const MAX_AGENTS = 5;
export const MAX_AGENT_TURNS = 10;
export const MAX_RUN_DURATION_SECONDS = 60;
// The structured drink-order envelope needs more than the old 250-token
// ceiling. 400 prevents intermittent truncation while every cheap-model call
// remains tightly bounded; providers bill actual output, not this ceiling.
export const MAX_OUTPUT_TOKENS_PER_AGENT = 400;
export const MAX_CONTEXT_EVENTS_PER_CALL = 6;
export const RISK_BLOCK_THRESHOLD = 80;
export const MAX_INPUT_CHARACTERS = 2_000;
export const MAX_REQUEST_BYTES = 32_000;
export const CHECKPOINT_TTL_SECONDS = 15 * 60;

/** Cheapest currently available model verified for the demo account. */
export const DEFAULT_LLM_MODEL = "gemini-3.1-flash-lite";

export const RUN_LIMITS: RunLimits = Object.freeze({
  maxAgents: MAX_AGENTS,
  maxAgentTurns: MAX_AGENT_TURNS,
  maxRunDurationSeconds: MAX_RUN_DURATION_SECONDS,
  maxOutputTokensPerAgent: MAX_OUTPUT_TOKENS_PER_AGENT,
  maxContextEventsPerCall: MAX_CONTEXT_EVENTS_PER_CALL,
  riskBlockThreshold: RISK_BLOCK_THRESHOLD,
});

export interface RuntimeConfig {
  readonly apiKey?: string;
  readonly model: string;
  readonly securityJudgeModel: string;
  readonly demoMode: boolean;
}

export function getRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const apiKey = env.LLM_API_KEY || env.GEMINI_API_KEY || undefined;
  const model = env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL;
  const securityJudgeModel =
    env.SECURITY_JUDGE_MODEL?.trim() || model;

  return Object.freeze({
    apiKey,
    model,
    securityJudgeModel,
    demoMode: env.DEMO_MODE !== "false",
  });
}

export function clampRiskScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}
