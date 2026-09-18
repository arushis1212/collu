import type { AgentEvent, RunMode } from "@/types/events";
import { RouteIcon } from "./Icons";

type UnknownRecord = Readonly<Record<string, unknown>>;

export type WorkingBrief = Readonly<{
  item?: string;
  quantity?: number;
  unitPriceCents?: number;
  totalCents?: number;
  budgetCents?: number;
  budgetEnabled?: boolean;
  approvalThresholdCents?: number;
  approvalRequired?: boolean;
  approvalGranted?: boolean;
  approval?: string;
}>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function firstString(source: UnknownRecord, keys: readonly string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(source: UnknownRecord, keys: readonly string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function approvalLabel(source: UnknownRecord) {
  const direct = firstString(source, [
    "approval",
    "approvalStatus",
    "authorization",
    "authorizationStatus",
  ]);
  if (direct) return direct;
  if (typeof source.freshApprovalRequired === "boolean") {
    if (!source.freshApprovalRequired) return "Not required";
    return source.freshApprovalGranted === true ? "Granted" : "Missing";
  }
  if (typeof source.approved === "boolean") return source.approved ? "Approved" : "Not approved";
  if (typeof source.authorized === "boolean") return source.authorized ? "Authorized" : "Not authorized";
  if (typeof source.confirmationRequired === "boolean") {
    return source.confirmationRequired ? "Confirmation required" : "No confirmation required";
  }
  if (typeof source.approvalRequired === "boolean") {
    return source.approvalRequired ? "Approval required" : "No approval required";
  }
  return undefined;
}

export function readWorkingBrief(event: AgentEvent): WorkingBrief | null {
  const source = record(event.metadata?.workingBrief);
  if (!source) return null;
  const scenario = record(event.metadata?.scenarioState);
  const quantity = firstNumber(source, ["quantity", "qty"]);
  const unitPriceCents = firstNumber(source, ["unitPriceCents", "priceCents"]);
  const brief: WorkingBrief = {
    item: firstString(source, ["item", "selectedItem", "drink", "product", "productName"]),
    quantity,
    unitPriceCents,
    totalCents:
      (scenario ? firstNumber(scenario, ["projectedTotalCents"]) : undefined) ??
      firstNumber(source, ["totalCents", "estimatedTotalCents", "subtotalCents"]) ??
      (quantity !== undefined && unitPriceCents !== undefined ? quantity * unitPriceCents : undefined),
    budgetCents: firstNumber(source, ["budgetCapCents", "budgetCents", "maxBudgetCents", "spendingLimitCents"]),
    budgetEnabled: typeof source.budgetCapEnabled === "boolean" ? source.budgetCapEnabled : undefined,
    approvalThresholdCents: firstNumber(source, ["approvalThresholdCents"]),
    approvalRequired: typeof source.freshApprovalRequired === "boolean" ? source.freshApprovalRequired : undefined,
    approvalGranted: typeof source.freshApprovalGranted === "boolean" ? source.freshApprovalGranted : undefined,
    approval: approvalLabel(source),
  };
  return Object.values(brief).some((value) => value !== undefined) ? brief : null;
}

export function readWorklog(event: AgentEvent): readonly string[] {
  const value = event.metadata?.worklog;
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) return [entry.trim()];
    const item = record(entry);
    if (!item) return [];
    const text = firstString(item, ["message", "text", "detail", "step"]);
    return text ? [text] : [];
  });
}

export function readNextStep(event: AgentEvent) {
  const value = event.metadata?.nextStep;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function briefSignature(brief: WorkingBrief | null) {
  if (!brief) return null;
  return JSON.stringify({
    item: brief.item?.toLocaleLowerCase(),
    quantity: brief.quantity,
    unitPriceCents: brief.unitPriceCents,
    totalCents: brief.totalCents,
    budgetCents: brief.budgetCents,
    budgetEnabled: brief.budgetEnabled,
    approvalThresholdCents: brief.approvalThresholdCents,
    approvalRequired: brief.approvalRequired,
    approvalGranted: brief.approvalGranted,
    approval: brief.approval?.toLocaleLowerCase(),
  });
}

export function workingBriefChanged(baseline: WorkingBrief | null, current: WorkingBrief | null) {
  const baselineSignature = briefSignature(baseline);
  const currentSignature = briefSignature(current);
  return Boolean(baselineSignature && currentSignature && baselineSignature !== currentSignature);
}

export function formatCents(value?: number) {
  if (value === undefined) return "Not set";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}

function valueOrWaiting(value: string | number | undefined) {
  return value === undefined || value === "" ? "Waiting" : String(value);
}

function briefRows(brief: WorkingBrief | null) {
  return [
    { label: "Item", value: valueOrWaiting(brief?.item) },
    { label: "Quantity", value: valueOrWaiting(brief?.quantity) },
    { label: "Unit price", value: formatCents(brief?.unitPriceCents) },
    { label: "Total", value: formatCents(brief?.totalCents) },
    {
      label: "Budget",
      value: brief?.budgetEnabled === false ? "Disabled" : formatCents(brief?.budgetCents),
    },
    { label: "Approval", value: valueOrWaiting(brief?.approval) },
  ] as const;
}

function latestMetadataNumber(events: readonly AgentEvent[], key: string, fallback: number) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = events[index].metadata?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const receipt = record(events[index].metadata?.receipt);
    const receiptValue = receipt?.[key];
    if (typeof receiptValue === "number" && Number.isFinite(receiptValue)) return receiptValue;
  }
  return fallback;
}

export type SandboxPanelProps = {
  events: AgentEvent[];
  attackEvent?: AgentEvent | null;
  mode: RunMode;
  traceAvailable: boolean;
  onTraceAttack: () => void;
};

export function SandboxPanel({
  events,
  attackEvent,
  mode,
  traceAvailable,
  onTraceAttack,
}: SandboxPanelProps) {
  const attackIndex = attackEvent
    ? events.findIndex((event) => event.id === attackEvent.id)
    : -1;
  const structured = events
    .map((event, index) => ({ event, index, brief: readWorkingBrief(event) }))
    .filter((entry): entry is { event: AgentEvent; index: number; brief: WorkingBrief } => Boolean(entry.brief));
  const preAttack = structured.filter((entry) => attackIndex < 0 || entry.index < attackIndex);
  const baseline = (preAttack.at(-1) ?? structured[0])?.brief ?? null;
  const current = structured.at(-1)?.brief ?? baseline;
  const changed = workingBriefChanged(baseline, current);
  const baselineRows = briefRows(baseline);
  const currentRows = briefRows(current);
  const sandboxResult = [...events].reverse().find((event) => event.eventType === "tool_result");
  const decision = typeof sandboxResult?.metadata?.decision === "string"
    ? sandboxResult.metadata.decision.replaceAll("_", " ")
    : "No action requested";
  const chargedCents = latestMetadataNumber(events, "chargedCents", 0);
  const externalEffects = latestMetadataNumber(events, "externalEffects", 0);

  return (
    <section
      className={`sandbox-panel ${changed ? "is-changed" : ""}`}
      aria-labelledby="sandbox-heading"
      data-testid="sandbox-panel"
    >
      <div className="sandbox-heading">
        <div>
          <span className="sandbox-kicker">Live sandbox state</span>
          <h2 id="sandbox-heading">What the agents are preparing</h2>
        </div>
        <span className={`sandbox-mode ${mode === "unprotected" ? "is-exposed" : ""}`}>
          {mode === "protected" ? "Blocking on" : "Blocking off"}
        </span>
      </div>

      <div className="sandbox-compare" data-brief-changed={changed ? "true" : "false"}>
        <article className="sandbox-brief is-baseline" data-testid="sandbox-baseline">
          <div className="sandbox-brief-heading">
            <strong>Authorized plan</strong>
            <span>Before the test attack</span>
          </div>
          <dl>
            {baselineRows.map((row) => (
              <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
            ))}
          </dl>
        </article>

        <article className={`sandbox-brief is-current ${changed ? "has-drifted" : ""}`} data-testid="sandbox-current">
          <div className="sandbox-brief-heading">
            <strong>Current agent plan</strong>
            <span>{changed ? "Changed from the authorized plan" : "Still matches the authorized plan"}</span>
          </div>
          <dl>
            {currentRows.map((row, index) => {
              const changedValue = baselineRows[index].value !== row.value;
              return (
                <div className={changedValue ? "is-different" : ""} key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              );
            })}
          </dl>
        </article>
      </div>

      <div className="sandbox-result" data-testid="sandbox-result">
        <div><span>Sandbox decision</span><strong>{decision}</strong></div>
        <div><span>Charged</span><strong>{formatCents(chargedCents)}</strong></div>
        <div><span>External effects</span><strong>{externalEffects}</strong></div>
      </div>

      <p className="sandbox-note">
        Peer-trusting test workload. It can stage a virtual receipt only; no checkout is connected.
      </p>

      {traceAvailable && (
        <button className="button sandbox-trace-button" onClick={onTraceAttack} type="button">
          <RouteIcon size={16} /> View live attack trace
        </button>
      )}
    </section>
  );
}
