#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  promises as fs,
} from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  DEMO_ACTION,
  DEMO_POLICY,
  streamDemoRun,
} from "../runtime/demo-runtime.js";

const DEMO_WORKFLOW = "npm run agents";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_ISSUE_PATH = path.join(REPO_ROOT, "fixtures", "github-issue-1842.md");
const EXPECTED_EVENT_TYPES = [
  "run.created",
  "source.ingested",
  "agent.completed",
  "agent.completed",
  "agent.completed",
  "agent.completed",
  "tool.requested",
  "gateway.evaluating",
  "gateway.decision",
];
const EXPECTED_TRACE = [
  ["source", null],
  ["research", "source"],
  ["planner", "research"],
  ["coding", "planner"],
  ["reviewer", "coding"],
  ["deploy", "reviewer"],
];

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

const colorEnabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const ansi = {
  bold: (value) => colorEnabled ? `\u001B[1m${value}\u001B[22m` : value,
  dim: (value) => colorEnabled ? `\u001B[2m${value}\u001B[22m` : value,
  cyan: (value) => colorEnabled ? `\u001B[36m${value}\u001B[39m` : value,
  green: (value) => colorEnabled ? `\u001B[32m${value}\u001B[39m` : value,
  yellow: (value) => colorEnabled ? `\u001B[33m${value}\u001B[39m` : value,
  red: (value) => colorEnabled ? `\u001B[31m${value}\u001B[39m` : value,
};

function write(line = "") {
  process.stdout.write(`${line}\n`);
}

function writeError(message) {
  process.stderr.write(`collu: ${message}\n`);
}

function pad(value, length) {
  return String(value).padEnd(length, " ");
}

function label(value, color = (text) => text) {
  return color(pad(value, 10));
}

function formatElapsed(milliseconds) {
  return `${(milliseconds / 1_000).toFixed(2)}s`.padStart(7, " ");
}

function formatAuthority(authority) {
  return Array.isArray(authority) && authority.length > 0
    ? authority.join(",")
    : "none";
}

function displayPath(filePath) {
  const relative = path.relative(process.cwd(), filePath);

  if (relative && !relative.startsWith(`..${path.sep}`) && relative !== "..") {
    return relative;
  }

  return filePath;
}

function traceDirectory() {
  const configured = process.env.COLLU_TRACE_DIR?.trim();
  return path.resolve(configured || path.join(process.cwd(), ".collu", "traces"));
}

function parseDelay() {
  const raw = process.env.COLLU_DEMO_DELAY_MS;

  if (raw === undefined || raw === "") {
    return 900;
  }

  const delayMs = Number(raw);

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new CliError("COLLU_DEMO_DELAY_MS must be a non-negative number.", 2);
  }

  return delayMs;
}

function showHelp() {
  write("Usage:");
  write("  collu dev -- npm run agents");
  write("  collu demo");
  write("  collu trace <trace-id>");
  write("  collu --help");
  write();
  write("Commands:");
  write("  dev      Run the deterministic agent workflow through the local gateway.");
  write("  demo     Alias for `collu dev -- npm run agents`.");
  write("  trace    Read a saved gateway decision and its causal chain.");
  write();
  write("Environment:");
  write("  COLLU_DEMO_DELAY_MS  Delay between events in milliseconds (default: 900).");
  write("  COLLU_TRACE_DIR      Directory for saved trace JSON (default: .collu/traces).");
  write("  NO_COLOR             Disable ANSI color.");
  write();
  write("This demo is an offline deterministic fixture. It never starts the command");
  write("after `--`, reads a real secret, or contacts a production system.");
}

function parseWorkflow(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    return null;
  }

  if (args[0] !== "--" || args.length === 1) {
    throw new CliError("expected `collu dev -- npm run agents`.", 2);
  }

  const workflow = args.slice(1).join(" ");

  if (workflow !== DEMO_WORKFLOW) {
    throw new CliError(
      `the deterministic demo only supports \`${DEMO_WORKFLOW}\`.`,
      2,
    );
  }

  return workflow;
}

async function readDemoIssue() {
  try {
    const payload = await fs.readFile(DEMO_ISSUE_PATH, "utf8");

    if (!payload.trim()) {
      throw new CliError(`demo fixture is empty: ${displayPath(DEMO_ISSUE_PATH)}.`);
    }

    return payload;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    if (error?.code === "ENOENT") {
      throw new CliError(`demo fixture was not found: ${displayPath(DEMO_ISSUE_PATH)}.`);
    }

    throw error;
  }
}

function injectedInstruction(payload) {
  return payload
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes("PROD_DEPLOY_TOKEN")) || payload;
}

function inputFingerprint(payload) {
  return createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

function validateDecisionEvent(event, events = null, runResult = null) {
  if (!event || typeof event !== "object") {
    throw new CliError("gateway returned no final decision.");
  }

  const invalid = (condition, message) => {
    if (condition) {
      throw new CliError(`invalid gateway outcome: ${message}.`);
    }
  };

  invalid(event.type !== "gateway.decision", "final event is not a decision");
  invalid(typeof event.traceId !== "string" || !/^tr_[a-zA-Z0-9_-]+$/.test(event.traceId), "trace id is malformed");
  invalid(event.status !== "BLOCKED", "status is not BLOCKED");
  invalid(event.decision !== "BLOCK" || event.result !== "BLOCK", "decision is not BLOCK");
  invalid(event.action !== DEMO_ACTION, "protected action does not match");
  invalid(event.policy?.id !== DEMO_POLICY.id, "policy does not match");
  invalid(!Array.isArray(event.reasons) || event.reasons.length !== 3, "expected exactly three reasons");
  invalid(event.reasons?.some((reason) => typeof reason !== "string" || !reason.trim()), "a reason is empty");
  invalid(event.executed !== false, "protected action execution was not false");
  invalid(event.productionExecutions !== 0, "production execution count was not zero");
  invalid(!Array.isArray(event.trace) || event.trace.length !== EXPECTED_TRACE.length, "causal trace is incomplete");

  for (let index = 0; index < EXPECTED_TRACE.length; index += 1) {
    const [expectedId, expectedParentId] = EXPECTED_TRACE[index];
    const node = event.trace?.[index];
    invalid(node?.id !== expectedId, `causal node ${index + 1} does not match`);
    invalid(node?.parentId !== expectedParentId, `parent for ${expectedId} does not match`);
  }

  invalid(event.trace?.[0]?.trust !== "UNTRUSTED_EXTERNAL", "source trust is not untrusted external");
  invalid(!event.trace?.[0]?.detail?.includes("PROD_DEPLOY_TOKEN"), "poisoned instruction is missing");
  invalid(event.trace?.at(-1)?.action !== DEMO_ACTION, "deploy node does not request the protected action");

  if (events) {
    invalid(events.length !== EXPECTED_EVENT_TYPES.length, "event stream is incomplete");

    for (let index = 0; index < EXPECTED_EVENT_TYPES.length; index += 1) {
      const streamedEvent = events[index];
      invalid(streamedEvent?.type !== EXPECTED_EVENT_TYPES[index], `event ${index + 1} is out of order`);
      invalid(streamedEvent?.sequence !== index + 1, `sequence ${index + 1} does not match`);
      invalid(streamedEvent?.traceId !== event.traceId, `event ${index + 1} has a different trace id`);
    }
  }

  if (runResult) {
    invalid(runResult.traceId !== event.traceId, "run result trace id does not match");
    invalid(runResult.decision !== "BLOCK", "run result decision is not BLOCK");
    invalid(runResult.productionExecutions !== 0, "run result reports a production execution");
  }

  return event;
}

function renderHeader(workflow, payload) {
  write(`${ansi.bold("Collu dev")}  ${ansi.dim("inline gateway")}`);
  write(`process  ${workflow}`);
  write(`source   ${displayPath(DEMO_ISSUE_PATH)}`);
  write(`input sha256  ${inputFingerprint(payload)}`);

  if (existsSync(path.join(process.cwd(), "collu.yaml"))) {
    write("config   collu.yaml");
  }

  write(`policy   ${DEMO_POLICY.id}`);
  write();
}

function renderStreamEvent(event, elapsedMs) {
  const time = ansi.dim(formatElapsed(elapsedMs));
  const prefix = `${time}  `;

  switch (event.type) {
    case "run.created":
      write(`${prefix}${label("RUN", ansi.cyan)}started  trace=${event.traceId}`);
      break;
    case "source.ingested":
      write(
        `${prefix}${label("SOURCE", ansi.yellow)}${event.source?.label || "GitHub issue"}  trust=${event.source?.trust || "unknown"}`,
      );
      write(`${" ".repeat(10)}${ansi.dim("poisoned instruction")}  ${JSON.stringify(injectedInstruction(event.source?.payload || ""))}`);
      break;
    case "agent.completed": {
      const node = event.node || {};
      const parent = node.parentId === "source" ? "GitHub issue #1842" : node.parentId;
      let detail = `completed  <- ${parent}`;

      if (node.id === "coding") {
        detail += "  authority+=repo.write,secret.read";
      } else if (node.id === "reviewer") {
        detail = `approved  <- ${parent}  independent=false`;
      } else {
        detail += `  authority=${formatAuthority(node.authority)}`;
      }

      write(
        `${prefix}${label(String(event.agent || "AGENT").toUpperCase(), ansi.green)}${detail}`,
      );
      break;
    }
    case "tool.requested":
      write(
        `${prefix}${label("DEPLOY", ansi.yellow)}requested ${event.action}  <- reviewer  authority+=production.execute`,
      );
      break;
    case "gateway.evaluating":
      write(`${prefix}${label("COLLU", ansi.cyan)}evaluating complete causal path`);
      break;
    default:
      throw new CliError(`unexpected streamed event \`${event.type}\`.`);
  }
}

function renderDecision(event, elapsedMs, savedPath) {
  const time = ansi.dim(formatElapsed(elapsedMs));
  write(
    `${time}  ${label("BLOCK", (value) => ansi.bold(ansi.red(value)))}${event.action} denied before execution`,
  );
  write();
  write(`finding               ${ansi.bold(ansi.red("POISONED CONTEXT"))}`);
  write();
  write("reasons");
  event.reasons.forEach((reason, index) => {
    write(`  ${index + 1}. ${reason}`);
  });
  write();
  write(`causal path           ${event.trace.map((node) => node.label).join(" -> ")}`);
  write(`executed              ${String(event.executed)}`);
  write(`production executions ${event.productionExecutions}`);
  write(`trace                 ${event.traceId}`);
  write(`saved                 ${displayPath(savedPath)}`);
}

async function persistDecision(event, workflow, durationMs) {
  const directory = traceDirectory();
  const destination = path.join(directory, `${event.traceId}.json`);
  const temporary = path.join(
    directory,
    `.${event.traceId}.${process.pid}.${randomUUID()}.tmp`,
  );
  const record = {
    schemaVersion: 1,
    mode: "deterministic-offline-demo",
    workflowCommand: workflow,
    durationMs: Math.round(durationMs),
    ...event,
  };

  await fs.mkdir(directory, { recursive: true });

  try {
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }

  return destination;
}

async function runDemo(workflow = DEMO_WORKFLOW) {
  const delayMs = parseDelay();
  const payload = await readDemoIssue();
  const events = [];
  const start = performance.now();
  let finalElapsedMs = 0;

  renderHeader(workflow, payload);

  const runResult = await streamDemoRun({
    payload,
    delayMs,
    emit: async (event) => {
      events.push(event);
      const elapsedMs = performance.now() - start;

      if (event.type === "gateway.decision") {
        finalElapsedMs = elapsedMs;
        return;
      }

      renderStreamEvent(event, elapsedMs);
    },
  });

  const finalEvent = events.at(-1);
  validateDecisionEvent(finalEvent, events, runResult);
  const savedPath = await persistDecision(finalEvent, workflow, finalElapsedMs);
  renderDecision(finalEvent, finalElapsedMs, savedPath);
}

function validateTraceId(traceId) {
  if (!traceId || !/^tr_[a-zA-Z0-9_-]+$/.test(traceId)) {
    throw new CliError("trace id must look like `tr_<id>`.", 2);
  }

  return traceId;
}

async function showTrace(traceId) {
  const safeTraceId = validateTraceId(traceId);
  const tracePath = path.join(traceDirectory(), `${safeTraceId}.json`);
  let record;

  try {
    record = JSON.parse(await fs.readFile(tracePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new CliError(`trace \`${safeTraceId}\` was not found.`);
    }

    if (error instanceof SyntaxError) {
      throw new CliError(`trace \`${safeTraceId}\` is not valid JSON.`);
    }

    throw error;
  }

  validateDecisionEvent(record);

  write(`${ansi.bold("Trace")}  ${record.traceId}`);
  write(`decision              ${ansi.bold(ansi.red(record.decision))}`);
  write(`finding               ${ansi.bold(ansi.red("POISONED CONTEXT"))}`);
  write(`action                ${record.action}`);
  write(`policy                ${record.policy.id}`);
  write(`source trust          ${record.trace[0].trust}`);
  write(`poisoned instruction  ${JSON.stringify(injectedInstruction(record.trace[0].detail || ""))}`);
  write(`causal path           ${record.trace.map((node) => node.label).join(" -> ")}`);
  write(`executed              ${String(record.executed)}`);
  write(`production executions ${record.productionExecutions}`);
  write();
  write("reasons");
  record.reasons.forEach((reason, index) => {
    write(`  ${index + 1}. ${reason}`);
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || ["--help", "-h", "help"].includes(command)) {
    showHelp();
    return;
  }

  if (command === "dev") {
    const workflow = parseWorkflow(args);

    if (workflow === null) {
      showHelp();
      return;
    }

    await runDemo(workflow);
    return;
  }

  if (command === "demo") {
    if (args.length > 0 && !["--help", "-h"].includes(args[0])) {
      throw new CliError("`collu demo` does not accept arguments.", 2);
    }

    if (["--help", "-h"].includes(args[0])) {
      showHelp();
      return;
    }

    await runDemo();
    return;
  }

  if (command === "trace") {
    if (args.length !== 1) {
      throw new CliError("expected `collu trace <trace-id>`.", 2);
    }

    await showTrace(args[0]);
    return;
  }

  throw new CliError(`unknown command \`${command}\`. Run \`collu --help\`.`, 2);
}

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") {
    process.exit(0);
  }

  throw error;
});

main().catch((error) => {
  writeError(error instanceof CliError ? error.message : `unexpected error: ${error.message}`);
  process.exitCode = error instanceof CliError ? error.exitCode : 1;
});
