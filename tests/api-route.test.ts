import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "@/app/api/run/route";
import { MAX_REQUEST_BYTES } from "@/lib/config";

function requestWithBody(body: string, headers: HeadersInit = {}): Request {
  return new Request("http://127.0.0.1/api/run", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function errorOf(response: Response): Promise<string> {
  const value: unknown = await response.json();
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const error = (value as { error?: unknown }).error;
  assert.equal(typeof error, "string");
  return error as string;
}

test("route rejects malformed JSON before opening a stream", async () => {
  const response = await POST(requestWithBody('{"action":'));

  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/i);
  assert.match(await errorOf(response), /valid json/i);
});

test("route enforces actual UTF-8 request bytes without trusting Content-Length", async () => {
  const body = JSON.stringify({
    action: "start",
    prompt: "é".repeat(MAX_REQUEST_BYTES),
    mode: "protected",
  });
  const request = requestWithBody(body);
  assert.equal(request.headers.get("content-length"), null);

  const response = await POST(request);

  assert.equal(response.status, 413);
  assert.match(await errorOf(response), /too large/i);
});

test("route rejects an oversized declared body before reading it", async () => {
  const response = await POST(
    requestWithBody("{}", { "content-length": String(MAX_REQUEST_BYTES + 1) }),
  );

  assert.equal(response.status, 413);
  assert.match(await errorOf(response), /too large/i);
});

test("route rejects client model, limit, and unknown-field overrides", async () => {
  const bodies = [
    { action: "start", prompt: "Review locally.", mode: "protected", model: "expensive-model" },
    {
      action: "start",
      prompt: "Review locally.",
      mode: "protected",
      limits: { maxAgentTurns: 1 },
    },
    { action: "start", prompt: "Review locally.", mode: "protected", surprise: true },
  ];

  for (const body of bodies) {
    const response = await POST(requestWithBody(JSON.stringify(body)));
    assert.equal(response.status, 400);
    assert.match(await errorOf(response), /unknown|field|allowed/i);
  }
});

test("route accepts only named controlled attacks, never custom payloads or targets", async () => {
  const bodies = [
    {
      action: "continue",
      checkpoint: "not-a-real-checkpoint",
      attack: { type: "agent_poisoning", payload: "custom attack" },
    },
    {
      action: "continue",
      checkpoint: "not-a-real-checkpoint",
      attack: { type: "agent_poisoning", targetAgent: "execution" },
    },
    {
      action: "continue",
      checkpoint: "not-a-real-checkpoint",
      attack: { type: "agent_poisoning", model: "client-model" },
    },
  ];

  for (const body of bodies) {
    const response = await POST(requestWithBody(JSON.stringify(body)));
    assert.equal(response.status, 400);
    const error = await errorOf(response);
    assert.match(error, /attack|unknown|field|allowed/i);
    assert.doesNotMatch(error, /custom attack|client-model/i);
  }
});
