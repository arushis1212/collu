import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "collu.mjs");
const fixturePath = path.join(repoRoot, "fixtures", "github-issue-1842.md");
const demoCommand = ["dev", "--", "npm", "run", "agents"];
const traceDirectory = await mkdtemp(path.join(os.tmpdir(), "collu-cli-smoke-"));

function withoutAnsi(value) {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

function runCli(arguments_, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...arguments_], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        COLLU_DEMO_DELAY_MS: "0",
        COLLU_TRACE_DIR: traceDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`CLI timed out after ${timeoutMs} ms: collu ${arguments_.join(" ")}`));
        return;
      }

      resolve({
        code,
        signal,
        stdout: withoutAnsi(stdout),
        stderr: withoutAnsi(stderr),
        output: withoutAnsi(`${stdout}\n${stderr}`),
      });
    });
  });
}

function assertOrdered(output, labels, context) {
  const comparableOutput = output.toLowerCase();
  let previousIndex = -1;
  for (const label of labels) {
    const index = comparableOutput.indexOf(label.toLowerCase(), previousIndex + 1);
    assert.notEqual(index, -1, `${context} omits ${label}.\n\n${output}`);
    assert.ok(index > previousIndex, `${context} shows ${label} out of order.\n\n${output}`);
    previousIndex = index;
  }
}

function assertDecisionProof(output, context) {
  assert.match(output, /deploy\.production\.execute/, `${context} omits the protected action.`);
  assert.match(
    output,
    /UNTRUSTED_EXTERNAL|untrusted(?:\s+GitHub)?\s+(?:issue|root|source)/i,
    `${context} omits the untrusted root source.`,
  );
  assert.match(output, /\bBLOCK\b/, `${context} omits the BLOCK decision.`);
  assert.match(
    output,
    /executed\s*(?::|=)?\s*(?:false|no)\b/i,
    `${context} does not prove executed=false.`,
  );
  assert.match(
    output,
    /production executions?\s*(?::|=)?\s*0\b/i,
    `${context} does not prove zero production executions.`,
  );

  const numberedReasons = output.match(/^\s*[1-9][.)]\s+.+$/gm) ?? [];
  assert.equal(
    numberedReasons.length,
    3,
    `${context} must show exactly three numbered reasons.\n\n${output}`,
  );
  assert.deepEqual(
    numberedReasons.map((line) => Number.parseInt(line.trim(), 10)),
    [1, 2, 3],
    `${context} must number its reasons 1 through 3.`,
  );
}

async function findJsonFiles(directory) {
  const matches = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findJsonFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      matches.push(entryPath);
    }
  }

  return matches;
}

try {
  await Promise.all([access(cliPath), access(fixturePath)]);

  const fixture = await readFile(fixturePath, "utf8");
  const poisonedInstruction = fixture
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes("PROD_DEPLOY_TOKEN"));

  assert.ok(
    poisonedInstruction,
    "The CLI fixture must contain the injected instruction Collu detects.",
  );

  const help = await runCli(["--help"]);
  assert.equal(help.code, 0, `collu --help exited ${help.code}.\n\n${help.output}`);
  assert.match(help.output, /collu\s+dev/i, "Help does not document collu dev.");
  assert.match(help.output, /collu\s+trace/i, "Help does not document collu trace.");

  const run = await runCli(demoCommand);
  assert.equal(run.code, 0, `Demo command exited ${run.code}.\n\n${run.output}`);
  assert.match(run.output, /\bCollu dev\b[\s\S]*inline gateway/i, "Demo output does not identify the Collu dev gateway.");
  assert.match(
    run.output,
    /npm\s+run\s+agents/,
    "Demo output does not show the intercepted target command.",
  );
  assert.match(
    run.output,
    /^input sha256\s+[a-f0-9]{12}\s*$/im,
    "Demo output does not identify the input with a SHA-256 fingerprint.",
  );
  assert.match(
    run.output,
    /POISONED CONTEXT/i,
    "Demo output does not explicitly reveal the poisoned context.",
  );
  assert.ok(
    run.output.includes(poisonedInstruction),
    `Demo output does not expose the injected instruction.\n\n${run.output}`,
  );
  assertOrdered(
    run.output,
    ["Research", "Planner", "Coding", "Reviewer", "Deploy"],
    "Demo output",
  );
  assertDecisionProof(run.output, "Demo output");
  assert.match(
    run.output,
    /Source[\s\S]*UNTRUSTED_EXTERNAL/i,
    "Demo output does not label the poisoned root as untrusted.",
  );

  const displayedTraceIds = run.output.match(/\btr_[a-z0-9-]+\b/gi) ?? [];
  assert.ok(displayedTraceIds.length > 0, `Demo output omits its trace ID.\n\n${run.output}`);
  const traceId = displayedTraceIds.at(-1);

  const traceFiles = await findJsonFiles(traceDirectory);
  assert.equal(
    traceFiles.length,
    1,
    `Expected exactly one persisted JSON trace, found ${traceFiles.length}: ${traceFiles.join(", ")}`,
  );

  const persisted = JSON.parse(await readFile(traceFiles[0], "utf8"));
  assert.equal(persisted.schemaVersion, 1, "Persisted trace uses an unexpected schema version.");
  assert.equal(persisted.traceId, traceId, "Persisted trace ID does not match the terminal output.");
  assert.equal(persisted.mode, "deterministic-offline-demo", "Persisted trace omits its deterministic demo mode.");
  assert.equal(persisted.workflowCommand, "npm run agents", "Persisted trace records the wrong command.");
  assert.ok(
    Number.isFinite(persisted.durationMs) && persisted.durationMs >= 0,
    "Persisted trace has an invalid duration.",
  );
  assert.equal(persisted.type, "gateway.decision", "Persisted trace is not a gateway decision.");
  assert.equal(persisted.status, "BLOCKED", "Persisted trace does not record BLOCKED state.");
  assert.equal(persisted.decision, "BLOCK", "Persisted trace does not record BLOCK.");
  assert.equal(persisted.result, "BLOCK", "Persisted trace does not record the BLOCK result.");
  assert.equal(
    persisted.action,
    "deploy.production.execute",
    "Persisted trace records the wrong protected action.",
  );
  assert.equal(persisted.executed, false, "Persisted trace does not record executed=false.");
  assert.equal(
    persisted.productionExecutions,
    0,
    "Persisted trace does not record zero production executions.",
  );
  assert.equal(persisted.reasons?.length, 3, "Persisted trace must contain exactly three reasons.");
  assert.equal(persisted.trace?.length, 6, "Persisted trace must contain the complete six-node ancestry.");
  assert.equal(persisted.trace?.[0]?.trust, "UNTRUSTED_EXTERNAL", "Persisted root is not untrusted.");
  assert.equal(
    path.basename(traceFiles[0]),
    `${traceId}.json`,
    "Persisted trace filename does not match its trace ID.",
  );

  const trace = await runCli(["trace", traceId]);
  assert.equal(trace.code, 0, `collu trace exited ${trace.code}.\n\n${trace.output}`);
  assert.match(trace.output, new RegExp(traceId, "i"), "Trace output omits the requested trace ID.");
  assertOrdered(
    trace.output,
    ["Research", "Planner", "Coding", "Reviewer", "Deploy"],
    "Trace output",
  );
  assertDecisionProof(trace.output, "Trace output");

  const afterTraceFiles = await findJsonFiles(traceDirectory);
  assert.equal(afterTraceFiles.length, 1, "Reading a trace unexpectedly wrote another JSON trace.");

  const invalid = await runCli(["definitely-not-a-command"]);
  assert.notEqual(invalid.code, 0, "An invalid command must exit nonzero.");
  assert.match(invalid.output, /unknown|invalid|usage/i, "Invalid command does not explain the failure.");

  console.log("CLI smoke test passed: realistic run, persisted proof, trace replay, help, errors.");
} finally {
  await rm(traceDirectory, { recursive: true, force: true });
}
