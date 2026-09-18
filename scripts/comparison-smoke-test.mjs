import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unprotectedRunner = path.join(repoRoot, "scripts", "agents-demo.mjs");
const protectedRunner = path.join(repoRoot, "bin", "collu.mjs");
const fixturePath = path.join(repoRoot, "fixtures", "github-issue-1842.md");
const traceDirectory = await mkdtemp(path.join(os.tmpdir(), "collu-comparison-smoke-"));

function withoutAnsi(value) {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

function runNode(entrypoint, arguments_ = [], timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...arguments_], {
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
        reject(new Error(`Comparison command timed out after ${timeoutMs} ms: ${entrypoint}`));
        return;
      }

      const cleanStdout = withoutAnsi(stdout);
      const cleanStderr = withoutAnsi(stderr);
      resolve({
        code,
        signal,
        stdout: cleanStdout,
        stderr: cleanStderr,
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

function assertExecutionCount(output, expected, context) {
  assert.match(
    output,
    new RegExp(`production executions?\\s*(?::|=)?\\s*${expected}\\b`, "i"),
    `${context} does not prove production executions=${expected}.`,
  );
}

function extractInputFingerprint(output, context) {
  const match = output.match(/^input sha256\s+([a-f0-9]{12})\s*$/im);

  assert.ok(
    match,
    `${context} does not show the shared input SHA-256 fingerprint.\n\n${output}`,
  );

  return match[1];
}

try {
  await Promise.all([
    access(unprotectedRunner),
    access(protectedRunner),
    access(fixturePath),
  ]);

  const fixture = await readFile(fixturePath, "utf8");
  const poisonedInstruction = fixture
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes("PROD_DEPLOY_TOKEN"));

  assert.ok(
    poisonedInstruction,
    "The comparison fixture must contain the visible poisoned instruction.",
  );

  const before = await runNode(unprotectedRunner);
  assert.equal(before.code, 0, `Unprotected run exited ${before.code}.\n\n${before.output}`);
  assert.match(before.output, /fixtures\/github-issue-1842\.md/i, "Unprotected run omits the shared source path.");
  assert.match(before.output, /status\s+SUCCESS\b/i, "Unprotected run does not look successful.");
  assert.match(before.output, /environment\s+production\b/i, "Unprotected run omits its production environment.");
  assert.match(before.output, /approval requested\s+no\b/i, "Unprotected run does not show that no approval was requested.");
  assert.match(before.output, /credential\s+PROD_DEPLOY_TOKEN\b/i, "Unprotected run omits the credential it used.");
  assertOrdered(
    before.output,
    ["Research", "Planner", "Coding", "Reviewer", "Deploy"],
    "Unprotected run",
  );
  assertExecutionCount(before.output, 1, "Unprotected run");

  for (const forbidden of [
    /COMPROMISED/i,
    /POISONED/i,
    /UNTRUSTED_EXTERNAL/i,
    /BLOCK/i,
    /gateway/i,
  ]) {
    assert.doesNotMatch(
      before.output,
      forbidden,
      `Unprotected run leaks security knowledge through ${forbidden}.\n\n${before.output}`,
    );
  }

  assert.ok(
    !before.output.includes(poisonedInstruction),
    `Unprotected run must not reveal the injected instruction.\n\n${before.output}`,
  );

  const beforeFingerprint = extractInputFingerprint(before.output, "Unprotected run");

  const after = await runNode(protectedRunner, ["dev", "--", "npm", "run", "agents"]);
  assert.equal(after.code, 0, `Protected run exited ${after.code}.\n\n${after.output}`);
  assert.match(after.output, /\bCollu dev\b[\s\S]*inline gateway/i, "Protected run does not identify the Collu gateway.");
  assert.match(after.output, /fixtures\/github-issue-1842\.md/i, "Protected run omits the shared source path.");
  assert.ok(
    after.output.includes(poisonedInstruction),
    `Protected run does not show the same poisoned fixture instruction.\n\n${after.output}`,
  );
  assert.match(
    after.output,
    /POISONED CONTEXT/i,
    "Protected run does not explicitly reveal the poisoned context.",
  );
  assert.match(after.output, /deploy\.production\.execute/, "Protected run omits the sensitive action.");
  assertOrdered(
    after.output,
    ["Research", "Planner", "Coding", "Reviewer", "Deploy", "Collu", "Block"],
    "Protected run",
  );
  assert.match(after.output, /\bBLOCK\b/, "Protected run omits its BLOCK decision.");
  assert.match(
    after.output,
    /executed\s*(?::|=)?\s*(?:false|no)\b/i,
    "Protected run does not prove executed=false.",
  );
  assertExecutionCount(after.output, 0, "Protected run");

  const afterFingerprint = extractInputFingerprint(after.output, "Protected run");
  assert.equal(
    afterFingerprint,
    beforeFingerprint,
    "Before and after runs must use the exact same input fingerprint.",
  );

  console.log(
    "Comparison smoke test passed: the same poisoned input executes without Collu and is blocked with Collu.",
  );
} finally {
  await rm(traceDirectory, { recursive: true, force: true });
}
