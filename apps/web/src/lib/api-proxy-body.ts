/** Stay below Vercel's 4.5 MB function ceiling, including multipart overhead. */
export const MAX_API_PROXY_BODY_BYTES = 4 * 1024 * 1024 + 64 * 1024;

export class ProxyPayloadTooLarge extends Error {}

/** Incremental limit: neither JSON nor multipart is buffered into an application arrayBuffer. */
export function boundedProxyBody(body: ReadableStream<Uint8Array> | null): ReadableStream<Uint8Array> | undefined {
  if (!body) return undefined;
  let bytes = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > MAX_API_PROXY_BODY_BYTES) throw new ProxyPayloadTooLarge();
      controller.enqueue(chunk);
    },
  }));
}

export function isProxyPayloadTooLarge(error: unknown): boolean {
  // Node fetch wraps stream failures as TypeError.cause.
  for (let depth = 0; depth < 5 && error; depth++) {
    if (error instanceof ProxyPayloadTooLarge) return true;
    error = (error as { cause?: unknown }).cause;
  }
  return false;
}
