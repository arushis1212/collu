import type {
  AttackKind,
  AttackRequest,
  RunRequest,
} from "@/types/events";
import { MAX_INPUT_CHARACTERS } from "@/lib/config";

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedText(
  value: unknown,
  label: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string") {
    throw new RequestValidationError(`${label} must be a string.`);
  }
  const text = value.trim();
  if (!allowEmpty && text.length === 0) {
    throw new RequestValidationError(`${label} cannot be empty.`);
  }
  if (text.length > MAX_INPUT_CHARACTERS) {
    throw new RequestValidationError(
      `${label} exceeds ${MAX_INPUT_CHARACTERS} characters.`,
    );
  }
  return text;
}

function parseAttack(value: unknown): AttackRequest {
  const input = objectValue(value, "attack");
  rejectUnknownKeys(input, new Set(["type"]), "attack");
  const validKinds = new Set<AttackKind>([
    "human_injection",
    "agent_poisoning",
    "propagation_attack",
  ]);
  if (!validKinds.has(input.type as AttackKind)) {
    throw new RequestValidationError("attack.type is invalid.");
  }
  return Object.freeze({
    type: input.type as AttackKind,
  });
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new RequestValidationError(
      `${label} contains unsupported field: ${unknown[0]}.`,
    );
  }
}

export function parseRunRequest(value: unknown): RunRequest {
  const input = objectValue(value, "request");
  if (input.action === "start") {
    rejectUnknownKeys(input, new Set(["action", "prompt", "mode"]), "request");
    const mode = input.mode;
    if (mode !== "protected" && mode !== "unprotected") {
      throw new RequestValidationError(
        "mode must be protected or unprotected.",
      );
    }
    return Object.freeze({
      action: "start",
      prompt: boundedText(input.prompt, "prompt"),
      mode,
    });
  }
  if (input.action === "continue") {
    rejectUnknownKeys(
      input,
      new Set(["action", "checkpoint", "attack"]),
      "request",
    );
    if (typeof input.checkpoint !== "string" || input.checkpoint.length === 0) {
      throw new RequestValidationError("checkpoint is required.");
    }
    if (input.checkpoint.length > 64_000) {
      throw new RequestValidationError("checkpoint is too large.");
    }
    return Object.freeze({
      action: "continue",
      checkpoint: input.checkpoint,
      ...(input.attack === undefined
        ? {}
        : { attack: parseAttack(input.attack) }),
    });
  }
  throw new RequestValidationError("action must be start or continue.");
}
