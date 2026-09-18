import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { streamDemoRun } from "../runtime/demo-runtime.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 4174;
const origin = `http://127.0.0.1:${port}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const expectedEventTypes = [
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

const expectedTraceLabels = [
  "Source",
  "Research",
  "Planner",
  "Coding",
  "Reviewer",
  "Deploy",
];

const responsiveViewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

const server = spawn(
  process.execPath,
  [
    path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--strictPort",
  ],
  { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
);

let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await sleep(100);
  }
  throw new Error(`Vite did not start in time.\n${serverLog}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`,
  );
}

async function malformedHostedStream(payload, traceId) {
  const events = [];
  await streamDemoRun({
    payload,
    traceId,
    delayMs: 0,
    emit: async (event) => events.push(event),
  });

  const malformedDecision = { ...events.at(-1) };
  delete malformedDecision.reasons;
  delete malformedDecision.trace;
  delete malformedDecision.executed;
  delete malformedDecision.productionExecutions;
  events[events.length - 1] = malformedDecision;

  assertEqual(
    events.map((event) => event.type),
    expectedEventTypes,
    "Malformed hosted fixture must otherwise preserve the exact 9-event stream.",
  );
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

async function appState(page) {
  return page.evaluate(() => window.__COLLU_DEMO__?.getState());
}

async function submitCommand(page, command) {
  const input = page.getByTestId("terminal-input");
  await input.fill(command);
  await input.press("Enter");
}

async function assertNoHorizontalOverflow(page, viewName) {
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      appVisible: Boolean(document.querySelector("#app")?.getClientRects().length),
    }));
    const widest = Math.max(layout.documentWidth, layout.bodyWidth);
    assert(
      widest <= layout.viewportWidth + 1,
      `${viewName} has horizontal overflow at ${viewport.width}px: ${widest}px page.`,
    );
    assert(layout.appVisible, `${viewName} disappeared at ${viewport.width}px.`);
  }
}

function traceLabels(state) {
  return (state.decision?.trace || []).map((node) => (
    node.kind === "source" ? "Source" : node.label
  ));
}

function assertBlockedState(state, expectedRuntime, runName) {
  assert(state.status === "blocked", `${runName} did not finish in the blocked state.`);
  assert(state.runtime === expectedRuntime, `${runName} used ${state.runtime}, not ${expectedRuntime}.`);
  assert(/^tr_[0-9a-f-]{20,}$/i.test(state.traceId), `${runName} did not produce a unique trace ID.`);
  assert(state.decision?.result === "BLOCK", `${runName} did not return BLOCK.`);
  assert(state.decision?.action === "deploy.production.execute", `${runName} evaluated the wrong protected action.`);
  assert(state.decision?.policy?.id === "external-input-requires-independent-approval", `${runName} reported the wrong policy.`);
  assert(state.decision?.executed === false, `${runName} claims the protected action executed.`);
  assert(state.decision?.reasons?.length === 3, `${runName} must report exactly three reasons.`);
  assert(state.productionExecutions === 0, `${runName} incremented production executions.`);

  const eventTypes = state.events.map((event) => event.type);
  assertEqual(eventTypes, expectedEventTypes, `${runName} emitted the wrong event stream.`);
  assertEqual(state.events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9], `${runName} emitted invalid sequence numbers.`);
  assert(
    state.events.every((event) => event.traceId === state.traceId),
    `${runName} did not keep one trace ID through the full stream.`,
  );
  assertEqual(traceLabels(state), expectedTraceLabels, `${runName} did not preserve the complete causal trace.`);
}

async function assertTerminalEvidence(page) {
  const terminalText = await page.getByTestId("terminal-output").innerText();
  for (const expected of [
    "Research",
    "Planner",
    "Coding",
    "Reviewer",
    "Deploy",
    "Collu",
    "Production request stopped.",
    "Open incident",
  ]) {
    assert(terminalText.includes(expected), `Terminal output omits ${expected}.`);
  }
  assert(terminalText.toLowerCase().includes("block"), "Terminal output omits the visible BLOCK result.");
  assert(
    (await page.getByTestId("production-execution-count").innerText()).trim() === "0",
    "The terminal does not visibly show zero production executions.",
  );
}

async function assertIncident(page, expectedTraceId) {
  assert(page.url().endsWith(`#/traces/${expectedTraceId}`), "Incident did not open on its trace hash route.");
  await page.getByTestId("incident-view").waitFor();
  assert(await page.getByTestId("incident-view").count() === 1, "Focused incident view did not render.");

  const incidentText = await page.getByTestId("incident-view").innerText();
  const pathText = await page.getByTestId("trace-path").innerText();
  assert(incidentText.includes("Production never received the request."), "Incident omits the protected-boundary outcome.");
  assert(incidentText.includes("GitHub issue #1842"), "Incident omits the root GitHub source.");
  assert(incidentText.includes("deploy.production.execute"), "Incident omits the protected action.");
  assert(incidentText.includes("External input requires independent approval"), "Incident omits the applied policy.");
  assert(incidentText.includes("Demo only"), "Response controls are not clearly labeled Demo only.");
  for (const label of [...expectedTraceLabels, "Collu"]) {
    assert(pathText.includes(label), `Incident causal path omits ${label}.`);
  }
  assert(await page.getByTestId("decision-reason").count() === 3, "Incident does not show exactly three decision reasons.");
  assert(
    (await page.getByTestId("production-execution-count").innerText()).trim() === "0",
    "Incident does not visibly show zero production executions.",
  );

  const responseControls = page.locator("[data-response]");
  assert(await responseControls.count() === 3, "Incident does not expose the three demo-only response previews.");
  await responseControls.first().click();
  await page.getByTestId("incident-view").getByText("No external system changed.", { exact: false }).waitFor();
  const afterPreview = await appState(page);
  assert(afterPreview.productionExecutions === 0, "A response preview changed production execution state.");
}

let browser;
try {
  await waitForServer();

  const healthResponse = await fetch(`${origin}/api/health`);
  const health = await healthResponse.json();
  assert(healthResponse.status === 200, `/api/health returned ${healthResponse.status}.`);
  assertEqual(
    health,
    { status: "ok", service: "collu-demo-runtime", gateway: "ready" },
    "/api/health returned the wrong runtime status.",
  );

  browser = await chromium.launch(
    existsSync(chromePath)
      ? { executablePath: chromePath, headless: true }
      : { headless: true },
  );
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(12_000);

  const browserErrors = [];
  const expectedTransportErrors = [];
  const externalRequests = [];
  let forcingBrowserFallback = false;
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (forcingBrowserFallback && message.text() === "Failed to load resource: net::ERR_FAILED") {
      expectedTransportErrors.push(message.text());
      return;
    }
    browserErrors.push(`console: ${message.text()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
      externalRequests.push(request.url());
    }
  });

  await page.goto(`${origin}/?fresh=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__COLLU_DEMO__));
  await page.evaluate(() => document.fonts.ready);

  const initial = await appState(page);
  assert(initial?.version === 1, "Developer workspace API did not initialize at state version 1.");
  assert(initial.status === "idle", `Fresh workspace started as ${initial.status}, not idle.`);
  assert(initial.runtime === null, "Fresh workspace already reports a runtime.");
  assert(initial.events.length === 0 && initial.decision === null, "Fresh workspace contains an old run.");
  assert(initial.productionExecutions === null, "Fresh workspace contains a production execution result.");
  assert(await page.getByTestId("run-workflow").count() === 1, "Workspace must expose exactly one Run workflow button.");
  assert((await page.getByTestId("run-workflow").innerText()).trim() === "Run workflow", "Primary action is not Run workflow.");
  assert(await page.getByTestId("issue-payload").isEditable(), "GitHub issue fixture is not editable before the run.");
  assert(await page.locator("[aria-live]").count() === 1, "Workspace must expose exactly one live region.");
  assert(await page.locator('nav, aside, [role="navigation"]').count() === 0, "Dashboard-style navigation is present in the workspace.");
  assert(await page.getByText("dashboard", { exact: false }).count() === 0, "Workspace describes itself as a dashboard.");
  assert(await page.locator("img, picture, video, svg, canvas").count() === 0, "Workspace contains decorative media.");
  const backgroundImages = await page.locator("body *").evaluateAll((elements) => (
    elements
      .filter((element) => getComputedStyle(element).backgroundImage !== "none")
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
  ));
  assert(backgroundImages.length === 0, `Workspace contains CSS background images: ${backgroundImages.join(", ")}`);
  await assertNoHorizontalOverflow(page, "Fresh workspace");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.__smokeChangeActions = [];
    window.addEventListener("collu-demo-change", (event) => {
      window.__smokeChangeActions.push(event.detail.action);
    });
  });

  await page.getByTestId("run-workflow").click();
  await page.waitForFunction(() => window.__COLLU_DEMO__.getState().status === "running");
  assert(!(await page.getByTestId("issue-payload").isEditable()), "Issue fixture was not locked while the workflow ran.");
  await page.waitForFunction(() => window.__COLLU_DEMO__.getState().events.length >= 3);
  const streaming = await appState(page);
  assert(streaming.status === "running", "API workflow did not visibly stream before completing.");
  await page.waitForFunction(() => window.__COLLU_DEMO__.getState().status === "blocked");

  const apiRun = await appState(page);
  assertBlockedState(apiRun, "api", "Hosted API run");
  const apiTraceId = apiRun.traceId;
  const changeActions = await page.evaluate(() => window.__smokeChangeActions);
  for (const action of ["run.requested", ...expectedEventTypes, "run.completed"]) {
    assert(changeActions.includes(action), `Workspace change stream omits ${action}.`);
  }
  await assertTerminalEvidence(page);
  await assertNoHorizontalOverflow(page, "Blocked workspace");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("open-incident").click();
  await page.waitForFunction((traceId) => window.location.hash === `#/traces/${traceId}`, apiTraceId);
  await assertIncident(page, apiTraceId);
  await assertNoHorizontalOverflow(page, "Incident view");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("back-terminal").click();
  await page.waitForFunction(() => window.location.hash === "#/");
  await page.getByTestId("terminal-output").waitFor();
  assert(await page.getByTestId("terminal-output").count() === 1, "Back to terminal did not restore the workspace.");

  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__COLLU_DEMO__));
  const persisted = await appState(page);
  assertBlockedState(persisted, "api", "Persisted API run");
  assert(persisted.traceId === apiTraceId, "Trace ID changed across reload.");
  await assertTerminalEvidence(page);

  await submitCommand(page, "cat collu.yaml");
  assert((await page.getByTestId("terminal-output").innerText()).includes("external_input_requires_independent_approval"), "cat collu.yaml did not show the inline policy.");
  await submitCommand(page, "help");
  assert((await page.getByTestId("terminal-output").innerText()).includes("Run the agent workflow"), "help did not show terminal commands.");
  await submitCommand(page, "definitely-not-a-command");
  assert((await page.getByTestId("terminal-output").innerText()).includes("Command not found"), "Unknown terminal commands do not fail clearly.");
  await submitCommand(page, "reset");
  await page.waitForFunction(() => window.__COLLU_DEMO__.getState().status === "idle");
  const reset = await appState(page);
  assert(reset.events.length === 0 && reset.decision === null, "reset did not clear the previous incident.");
  assert(reset.runtime === null && reset.traceId === null, "reset retained runtime trace state.");
  assert(reset.productionExecutions === null, "reset retained the previous execution result.");
  assert(await page.getByTestId("issue-payload").isEditable(), "reset did not unlock the issue fixture.");

  let fallbackRequestsAborted = 0;
  forcingBrowserFallback = true;
  await page.route("**/api/run", async (route) => {
    fallbackRequestsAborted += 1;
    await route.abort("failed");
  });
  await submitCommand(page, "run");
  await page.waitForFunction(() => window.__COLLU_DEMO__.getState().runtime === "browser");
  await page.waitForFunction(() => window.__COLLU_DEMO__.getState().status === "blocked", null, { timeout: 12_000 });
  forcingBrowserFallback = false;
  const browserRun = await appState(page);
  assert(fallbackRequestsAborted === 1, `Expected to abort one /api/run request; aborted ${fallbackRequestsAborted}.`);
  assertBlockedState(browserRun, "browser", "Browser fallback run");
  assert(browserRun.traceId !== apiTraceId, "Fallback run reused the prior API trace ID.");
  const fallbackTerminal = await page.getByTestId("terminal-output").innerText();
  assert(
    fallbackTerminal.includes("Hosted runtime unavailable") && fallbackTerminal.includes("same deterministic policy locally in your browser"),
    "Browser fallback is not disclosed truthfully in the terminal.",
  );
  await assertTerminalEvidence(page);
  await assertNoHorizontalOverflow(page, "Fallback workspace");

  await page.waitForTimeout(50);
  await page.unroute("**/api/run");
  await submitCommand(page, "reset");
  await page.waitForFunction(() => window.__COLLU_DEMO__.getState().status === "idle");

  const malformedTraceId = "tr_malformed-hosted-final";
  let malformedHostedRequests = 0;
  await page.evaluate(() => {
    window.__malformedHostedActions = [];
    window.addEventListener("collu-demo-change", (event) => {
      window.__malformedHostedActions.push(event.detail.action);
    });
  });
  await page.route("**/api/run", async (route) => {
    malformedHostedRequests += 1;
    const requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      },
      body: await malformedHostedStream(requestBody.payload, malformedTraceId),
    });
  });

  await submitCommand(page, "collu dev -- npm run agents");
  await page.waitForFunction(() => window.__COLLU_DEMO__.getState().runtime === "browser");
  await page.waitForFunction(() => window.__COLLU_DEMO__.getState().status === "blocked", null, { timeout: 12_000 });
  const malformedRecovery = await appState(page);
  assert(malformedHostedRequests === 1, `Expected one malformed hosted stream; served ${malformedHostedRequests}.`);
  assertBlockedState(malformedRecovery, "browser", "Malformed hosted-decision recovery");
  assert(malformedRecovery.traceId !== malformedTraceId, "UI accepted the malformed hosted gateway decision.");
  assert(malformedRecovery.traceId !== browserRun.traceId, "Malformed-decision recovery reused the prior fallback trace ID.");
  assert(malformedRecovery.productionExecutions === 0, "Malformed hosted-decision recovery changed production execution state.");

  const malformedRecoveryTerminal = await page.getByTestId("terminal-output").innerText();
  assert(
    malformedRecoveryTerminal.includes("Hosted runtime unavailable")
      && malformedRecoveryTerminal.includes("same deterministic policy locally in your browser"),
    "Malformed hosted decision did not produce the truthful browser-fallback notice.",
  );
  await assertTerminalEvidence(page);

  const malformedActions = await page.evaluate(() => window.__malformedHostedActions);
  assert(malformedActions.includes("runtime.fallback"), "Malformed hosted decision did not emit runtime.fallback.");
  assert(
    malformedActions.filter((action) => action === "gateway.decision").length === 1,
    "Malformed hosted gateway decision was applied instead of rejected before local recovery.",
  );

  assert(browserErrors.length === 0, `Browser errors:\n${browserErrors.join("\n")}`);
  assert(expectedTransportErrors.length <= 1, "The intentional API abort emitted unexpected duplicate transport errors.");
  assert(externalRequests.length === 0, `Demo made external requests:\n${externalRequests.join("\n")}`);

  console.log([
    "Smoke test passed:",
    "health endpoint, sparse developer workspace, real 9-event API stream,",
    "inline BLOCK with three reasons and zero production executions,",
    "focused incident trace, demo-only responses, persistence, terminal commands,",
    "truthful browser fallback (including malformed hosted decisions), responsive layouts,",
    "and zero browser/external-request errors.",
  ].join(" "));
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
