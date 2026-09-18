#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const FIXTURE_PATH = path.join(
  PROJECT_DIRECTORY,
  "fixtures",
  "github-issue-1842.md",
);
const DEFAULT_DELAY_MS = 900;

class DemoError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "DemoError";
    this.exitCode = exitCode;
  }
}

const colorEnabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const ansi = {
  bold: (value) => colorEnabled ? `\u001B[1m${value}\u001B[22m` : value,
  dim: (value) => colorEnabled ? `\u001B[2m${value}\u001B[22m` : value,
  green: (value) => colorEnabled ? `\u001B[32m${value}\u001B[39m` : value,
};

function write(line = "") {
  process.stdout.write(`${line}\n`);
}

function wait(milliseconds) {
  if (!milliseconds) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function parseDelay() {
  const raw = process.env.COLLU_DEMO_DELAY_MS;

  if (raw === undefined || raw === "") {
    return DEFAULT_DELAY_MS;
  }

  const delayMs = Number(raw);

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new DemoError(
      "COLLU_DEMO_DELAY_MS must be a non-negative number.",
      2,
    );
  }

  return delayMs;
}

function formatElapsed(milliseconds) {
  return `${(milliseconds / 1_000).toFixed(2)}s`.padStart(7, " ");
}

function pad(value, length) {
  return String(value).padEnd(length, " ");
}

function label(value, color = (text) => text) {
  return color(pad(value, 10));
}

async function runUnprotectedWorkflow() {
  const delayMs = parseDelay();
  const payload = await readFile(FIXTURE_PATH, "utf8");
  const inputFingerprint = createHash("sha256")
    .update(payload)
    .digest("hex")
    .slice(0, 12);
  const start = performance.now();
  let productionExecutions = 0;

  const elapsed = () => formatElapsed(performance.now() - start);
  const step = async (stage, message, color) => {
    await wait(delayMs);
    write(`${ansi.dim(elapsed())}  ${label(stage, color)}${message}`);
  };

  // This callback is deliberately local. It proves that the unprotected path
  // reached its execution boundary without contacting a secret or deployment API.
  const simulateProductionCallback = async () => {
    productionExecutions += 1;
    return { simulated: true };
  };

  write(ansi.bold("Agent workflow"));
  write("process     npm run agents");
  write("source      fixtures/github-issue-1842.md");
  write(`input sha256        ${inputFingerprint}`);
  write();
  write(
    `${ansi.dim(formatElapsed(0))}  ${label("RUN", ansi.green)}started`,
  );

  await step(
    "SOURCE",
    "loaded GitHub issue #1842",
    ansi.green,
  );

  await step(
    "RESEARCH",
    "completed  <- GitHub issue #1842  authority=repo.read",
    ansi.green,
  );
  await step(
    "PLANNER",
    "completed  <- research  authority=repo.read",
    ansi.green,
  );
  await step(
    "CODING",
    "completed  <- planner  implementation ready",
    ansi.green,
  );
  await step(
    "REVIEWER",
    "approved  <- coding",
    ansi.green,
  );
  await step(
    "DEPLOY",
    "deploying release to production  <- reviewer",
    ansi.green,
  );
  await step(
    "EXECUTE",
    "production deployment submitted",
    ansi.green,
  );

  const result = await simulateProductionCallback();

  if (!result.simulated || productionExecutions !== 1) {
    throw new DemoError("simulated production callback did not execute once.");
  }

  await step(
    "COMPLETE",
    "release completed successfully",
    ansi.green,
  );

  write();
  write(`status                ${ansi.bold(ansi.green("SUCCESS"))}`);
  write("environment           production");
  write("approval requested    no");
  write("credential            PROD_DEPLOY_TOKEN");
  write(`production executions ${productionExecutions}`);
  write();
  write(
    ansi.dim("Local fixture only. No real secret, network, or deployment was used."),
  );
}

runUnprotectedWorkflow().catch((error) => {
  process.stderr.write(`agents-demo: ${error.message}\n`);
  process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
});
