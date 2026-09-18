import { getCheckpointSecret, verifyCheckpoint } from "@/lib/checkpoint";
import { MAX_REQUEST_BYTES } from "@/lib/config";
import { orchestrate } from "@/lib/orchestrator";
import { createNdjsonStream } from "@/lib/stream";
import {
  parseRunRequest,
  RequestValidationError,
} from "@/lib/validation";
import type { StreamEnvelope } from "@/types/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff",
} as const;

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function* recoverStreamErrors(
  source: AsyncIterable<StreamEnvelope>,
): AsyncGenerator<StreamEnvelope> {
  let runId = "unknown";
  let phase: 1 | 2 = 1;
  let eventCount = 0;
  try {
    for await (const envelope of source) {
      if ("runId" in envelope) runId = envelope.runId;
      if ("phase" in envelope) phase = envelope.phase;
      if (envelope.type === "event") eventCount += 1;
      yield envelope;
    }
  } catch {
    yield {
      type: "complete",
      runId,
      phase,
      status: "error",
      eventCount,
      message: "The run stopped safely after an unexpected runtime error.",
    };
  }
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("Request body is too large.", 413);
  }

  let value: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
      return errorResponse("Request body is too large.", 413);
    }
    value = JSON.parse(body);
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  try {
    const runRequest = parseRunRequest(value);
    // Authenticate and validate continuations before committing streaming headers.
    if (runRequest.action === "continue") {
      verifyCheckpoint(runRequest.checkpoint, getCheckpointSecret());
    }
    const stream = createNdjsonStream(
      recoverStreamErrors(orchestrate(runRequest)),
    );
    return new Response(stream, { status: 200, headers: STREAM_HEADERS });
  } catch (error) {
    const message =
      error instanceof RequestValidationError
        ? error.message
        : error instanceof Error && /checkpoint/i.test(error.message)
          ? error.message
          : "Unable to start the run.";
    return errorResponse(message, 400);
  }
}
