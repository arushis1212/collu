import type { StreamEnvelope } from "@/types/events";

const encoder = new TextEncoder();

export function encodeNdjson(envelope: StreamEnvelope): Uint8Array {
  return encoder.encode(`${JSON.stringify(envelope)}\n`);
}

export function createNdjsonStream(
  envelopes: AsyncIterable<StreamEnvelope>,
): ReadableStream<Uint8Array> {
  const iterator = envelopes[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encodeNdjson(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
