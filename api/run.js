import { normalizePayload, streamDemoRun } from "../runtime/demo-runtime.js";

const MAX_BODY_BYTES = 16_384;

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  if (request.body !== undefined && request.body !== null) {
    if (typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
      return request.body;
    }

    const bodyText = Buffer.isBuffer(request.body)
      ? request.body.toString("utf8")
      : String(request.body);
    return JSON.parse(bodyText);
  }

  const chunks = [];
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;

    if (byteLength > MAX_BODY_BYTES) {
      const error = new RangeError("request body is too large");
      error.statusCode = 413;
      throw error;
    }

    chunks.push(buffer);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getSpeed(request) {
  if (typeof request.query?.speed === "string") {
    return request.query.speed;
  }

  const host = request.headers?.host || "localhost";
  const url = new URL(request.url || "/api/run", `http://${host}`);
  return url.searchParams.get("speed");
}

export default async function runHandler(request, response) {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.setHeader("Allow", "POST, OPTIONS");
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  let payload;

  try {
    const body = await readJsonBody(request);
    payload = normalizePayload(body.payload);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    sendJson(response, statusCode, {
      error: "invalid_request",
      message: error.message,
    });
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-store, no-transform");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();

  try {
    await streamDemoRun({
      payload,
      delayMs: getSpeed(request) === "fast" ? 0 : undefined,
      emit(event) {
        response.write(`${JSON.stringify(event)}\n`);
      },
    });
  } catch (error) {
    response.write(
      `${JSON.stringify({
        type: "run.failed",
        message: "The demo run could not be completed.",
      })}\n`,
    );
  }

  response.end();
}
