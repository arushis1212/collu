import { spawn, spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recordingDir = path.join(repoRoot, ".recordings");
const rawDir = path.join(recordingDir, "raw");
const rawVideo = path.join(recordingDir, "collu-fallback-demo.webm");
const publicDir = path.join(repoRoot, "public");
const demoDir = path.join(repoRoot, "demo");
const publicVideo = path.join(publicDir, "collu-fallback-demo.mp4");
const demoVideo = path.join(demoDir, "collu-fallback-demo.mp4");
const audioTrack = path.join(publicDir, "audio", "collu-fallback-voiceover.m4a");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = Number(process.env.COLLU_RECORD_PORT || 4175);
const origin = `http://127.0.0.1:${port}`;
const demoDurationMs = 48_000;

try {
  await access(audioTrack);
} catch {
  throw new Error(
    `Missing fallback narration at ${path.relative(repoRoot, audioTrack)}. `
      + "Generate the voiceover before running npm run record.",
  );
}

await rm(recordingDir, { recursive: true, force: true });
await mkdir(rawDir, { recursive: true });
await mkdir(publicDir, { recursive: true });
await mkdir(demoDir, { recursive: true });

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

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // Vite and its local API middleware are still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The Collu dev server did not start in time.\n${serverLog}`);
}

let browser;
let trimSeconds = 0;

try {
  await waitForServer();

  const launchOptions = {
    headless: true,
    args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
  };
  try {
    await access(chromePath);
    launchOptions.executablePath = chromePath;
  } catch {
    // Use Playwright's Chromium when system Chrome is unavailable.
  }

  browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 810 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: rawDir,
      size: { width: 1440, height: 810 },
    },
  });

  const page = await context.newPage();
  const captureStartedAt = Date.now();
  const video = page.video();
  page.setDefaultTimeout(10_000);

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(`console: ${message.text()}`);
  });

  await page.goto(`${origin}/?fresh=1&recording=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__COLLU_DEMO__));
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.documentElement.dataset.recording = "true";

    const style = document.createElement("style");
    style.textContent = `
      #recording-pointer {
        position: fixed;
        z-index: 2147483647;
        left: 0;
        top: 0;
        width: 18px;
        height: 18px;
        margin: -9px 0 0 -9px;
        border: 2px solid #070a08;
        border-radius: 50%;
        background: #39f06f;
        box-shadow: 0 0 0 3px rgba(255,255,255,.94), 0 4px 14px rgba(7,10,8,.28);
        pointer-events: none;
        opacity: 0;
        transform: translate3d(1380px, 110px, 0) scale(1);
        transition: transform 360ms cubic-bezier(.2,0,0,1), opacity 220ms ease;
      }
      #recording-pointer.is-visible { opacity: 1; }
    `;
    document.head.append(style);

    const pointer = document.createElement("div");
    pointer.id = "recording-pointer";
    pointer.setAttribute("aria-hidden", "true");
    document.body.append(pointer);
  });

  async function waitUntil(targetMs, startedAt) {
    const remaining = targetMs - (Date.now() - startedAt);
    if (remaining > 0) await page.waitForTimeout(remaining);
  }

  async function clickLocatorAt(locator, cueMs, startedAt) {
    await waitUntil(cueMs - 700, startedAt);
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error("Unable to locate a visible control for the recording.");

    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await page.evaluate(({ nextX, nextY }) => {
      const pointer = document.querySelector("#recording-pointer");
      pointer.style.transform = `translate3d(${nextX}px, ${nextY}px, 0) scale(1)`;
      pointer.classList.add("is-visible");
    }, { nextX: x, nextY: y });

    await waitUntil(cueMs - 100, startedAt);
    await page.evaluate(({ clickX, clickY }) => {
      const pointer = document.querySelector("#recording-pointer");
      pointer.style.transform = `translate3d(${clickX}px, ${clickY}px, 0) scale(.68)`;
    }, { clickX: x, clickY: y });

    await waitUntil(cueMs, startedAt);
    await page.mouse.click(x, y);
    await page.waitForTimeout(90);
    await page.evaluate(({ clickX, clickY }) => {
      const pointer = document.querySelector("#recording-pointer");
      pointer.style.transform = `translate3d(${clickX}px, ${clickY}px, 0) scale(1)`;
    }, { clickX: x, clickY: y });
  }

  async function hidePointer() {
    await page.evaluate(() => {
      document.querySelector("#recording-pointer")?.classList.remove("is-visible");
    });
  }

  async function scrollSectionAt(selector, cueMs, startedAt) {
    await waitUntil(cueMs, startedAt);
    await page.locator(selector).evaluate((element) => {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    await page.waitForTimeout(900);
  }

  // The encoded movie begins with the fully rendered developer workspace.
  await page.waitForTimeout(700);
  const startedAt = Date.now();
  trimSeconds = Math.max(0, (startedAt - captureStartedAt) / 1000);

  // One real interaction starts the existing workflow. Every agent event after
  // this point arrives automatically from the streamed local API.
  await clickLocatorAt(page.getByTestId("run-workflow"), 4_800, startedAt);
  await hidePointer();
  await page.mouse.move(720, 56);
  await page.waitForFunction(() => {
    const current = window.__COLLU_DEMO__?.getState();
    return current?.status === "blocked"
      && current?.decision?.result === "BLOCK"
      && current?.productionExecutions === 0;
  });

  const blockedState = await page.evaluate(() => window.__COLLU_DEMO__.getState());
  if (blockedState.runtime !== "api") {
    throw new Error(`Recording used ${blockedState.runtime || "no"} runtime instead of the streamed API.`);
  }
  if (blockedState.events.length !== 9) {
    throw new Error(`Expected 9 streamed events, received ${blockedState.events.length}.`);
  }

  // Hold on the terminal proof, then open the trace generated by this run.
  await clickLocatorAt(page.getByTestId("open-incident"), 28_400, startedAt);
  await page.getByTestId("incident-view").waitFor({ state: "visible" });
  await hidePointer();

  // Show the untrusted root and zero-execution result, then follow the causal
  // path down to the exact policy reasons before the narration ends.
  await scrollSectionAt(".incident-path", 33_200, startedAt);
  await scrollSectionAt(".incident-decision", 40_500, startedAt);
  await waitUntil(demoDurationMs + 350, startedAt);

  const finalState = await page.evaluate(() => window.__COLLU_DEMO__.getState());
  const finalReasons = finalState.decision?.reasons || [];
  const finalTrace = finalState.decision?.trace || [];
  if (
    finalState.status !== "blocked"
    || finalState.decision?.result !== "BLOCK"
    || finalState.decision?.action !== "deploy.production.execute"
    || finalState.decision?.executed !== false
    || finalState.productionExecutions !== 0
    || finalReasons.length !== 3
    || finalTrace.length < 6
  ) {
    throw new Error(`Recording ended in an invalid state: ${JSON.stringify(finalState)}`);
  }
  if (pageErrors.length) {
    throw new Error(`Browser errors during recording:\n${pageErrors.join("\n")}`);
  }

  await page.close();
  await context.close();
  const capturedPath = await video.path();
  await rename(capturedPath, rawVideo);
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}

const encoded = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss", trimSeconds.toFixed(3),
    "-i", rawVideo,
    "-i", audioTrack,
    "-t", String(demoDurationMs / 1000),
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-vf", "scale=1920:1080:flags=lanczos,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
    "-af", `apad=whole_dur=${demoDurationMs / 1000}`,
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "16",
    "-pix_fmt", "yuv420p",
    "-colorspace", "bt709",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-color_range", "tv",
    "-r", "30",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    publicVideo,
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

if (encoded.status !== 0) {
  throw new Error(`FFmpeg exited with status ${encoded.status}.`);
}

const probe = spawnSync(
  "ffprobe",
  [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,pix_fmt,color_space,color_transfer,color_primaries,color_range",
    "-of", "json",
    publicVideo,
  ],
  { cwd: repoRoot, encoding: "utf8" },
);

if (probe.status !== 0) {
  throw new Error(`FFprobe exited with status ${probe.status}: ${probe.stderr}`);
}

const stream = JSON.parse(probe.stdout).streams?.[0];
if (
  stream?.codec_name !== "h264"
  || stream?.width !== 1920
  || stream?.height !== 1080
  || stream?.r_frame_rate !== "30/1"
  || stream?.pix_fmt !== "yuv420p"
  || stream?.color_space !== "bt709"
  || stream?.color_transfer !== "bt709"
  || stream?.color_primaries !== "bt709"
  || stream?.color_range !== "tv"
) {
  throw new Error(`Encoded video does not match the delivery spec: ${JSON.stringify(stream)}`);
}

await copyFile(publicVideo, demoVideo);
const demoFiles = await readdir(demoDir);
if (!demoFiles.includes(path.basename(demoVideo))) {
  throw new Error("Recording completed without producing the demo copy.");
}

console.log(
  `\nRecorded one continuous Collu browser walkthrough to:\n`
    + `- ${path.relative(repoRoot, publicVideo)}\n`
    + `- ${path.relative(repoRoot, demoVideo)}`,
);
