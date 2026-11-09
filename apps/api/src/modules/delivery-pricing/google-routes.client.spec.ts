import {
  GoogleRoutesClient,
  GoogleRoutesClientError,
  GOOGLE_ROUTES_ERROR_BODY_MAX_BYTES,
} from "./google-routes.client";
import {
  GOOGLE_ROUTES_TIMEOUT_MS,
  GOOGLE_ROUTES_URL,
  RESTAURANT_ORIGIN,
} from "./delivery-pricing.constants";

const originalFetch = global.fetch;
const originalApiKey = process.env.GOOGLE_MAPS_ROUTES_API_KEY;

function response(status: number, body: unknown): Response {
  if (status >= 400) return new Response(JSON.stringify(body), { status });
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("GoogleRoutesClient", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_ROUTES_API_KEY = "server-only-test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GOOGLE_MAPS_ROUTES_API_KEY = originalApiKey;
    jest.useRealTimers();
  });

  it("requests only traffic-unaware driving distance", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(response(200, { routes: [{ distanceMeters: 6_001,
        legs: [{ endLocation: { latLng: RESTAURANT_ORIGIN } }] }] }));
    global.fetch = fetchMock as typeof fetch;

    await expect(
      new GoogleRoutesClient().computeDrivingDistanceMetres(
        "123 Example Street, London, ON N5W 3C1, Canada",
      ),
    ).resolves.toBe(6_001);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(GOOGLE_ROUTES_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": "server-only-test-key",
      "X-Goog-FieldMask": "routes.distanceMeters,routes.legs.endLocation.latLng",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      origin: { location: { latLng: RESTAURANT_ORIGIN } },
      destination: {
        address: "123 Example Street, London, ON N5W 3C1, Canada",
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      computeAlternativeRoutes: false,
    });
  });

  it("times out after five seconds without retrying", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    global.fetch = fetchMock as typeof fetch;

    const request = new GoogleRoutesClient().computeDrivingDistanceMetres(
      "123 Example Street, London, ON N5W 3C1, Canada",
    );
    const expectation = expect(request).rejects.toMatchObject({ reason: "TIMEOUT" });
    await jest.advanceTimersByTimeAsync(GOOGLE_ROUTES_TIMEOUT_MS);

    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "INVALID_REQUEST"],
    [404, "INVALID_REQUEST"],
    [401, "NOT_CONFIGURED"],
    [403, "NOT_CONFIGURED"],
    [429, "RATE_LIMITED"],
    [500, "PROVIDER_ERROR"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    global.fetch = jest.fn().mockResolvedValue(response(status, {})) as typeof fetch;

    await expect(
      new GoogleRoutesClient().computeDrivingDistanceMetres("destination"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<GoogleRoutesClientError>>({
        reason: reason as GoogleRoutesClientError["reason"],
        diagnostics: { httpStatus: status },
      }),
    );
  });

  it.each([
    [{ routes: [] }, "UNROUTABLE"],
    [{}, "UNROUTABLE"],
    [null, "MALFORMED_RESPONSE"],
    [[], "MALFORMED_RESPONSE"],
    [{ routes: null }, "MALFORMED_RESPONSE"],
    [{ routes: {} }, "MALFORMED_RESPONSE"],
    [{ routes: [{ distanceMeters: 6000 }] }, "MALFORMED_RESPONSE"],
    [{ routes: [{ distanceMeters: "6000" }] }, "MALFORMED_RESPONSE"],
  ])("rejects unusable route response %#", async (body, reason) => {
    global.fetch = jest.fn().mockResolvedValue(response(200, body)) as typeof fetch;

    await expect(
      new GoogleRoutesClient().computeDrivingDistanceMetres("destination"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<GoogleRoutesClientError>>({
        reason: reason as GoogleRoutesClientError["reason"],
      }),
    );
  });

  it("rejects a routed destination outside the municipality even with London in the input", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, { routes: [{
      distanceMeters: 10000,
      legs: [{ endLocation: { latLng: { latitude: 43.01, longitude: -81.09 } } }],
    }] })) as typeof fetch;
    await expect(new GoogleRoutesClient().computeDrivingDistanceMetres("Forged city, London, ON"))
      .rejects.toMatchObject({ reason: "OUTSIDE_CITY" });
  });

  it("never includes provider error bodies, addresses or credentials in errors", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(400, {
      error: { message: "private address server-only-test-key", status: "INVALID_ARGUMENT" },
    })) as typeof fetch;
    await expect(new GoogleRoutesClient().computeDrivingDistanceMetres("private address"))
      .rejects.toMatchObject({ reason: "INVALID_REQUEST", message: "Google Routes rejected the request" });
  });

  it.each([
    [400, "API_KEY_INVALID", "NOT_CONFIGURED"],
    [403, "API_KEY_SERVICE_BLOCKED", "NOT_CONFIGURED"],
    [403, "API_KEY_HTTP_REFERRER_BLOCKED", "NOT_CONFIGURED"],
    [403, "API_KEY_IP_ADDRESS_BLOCKED", "NOT_CONFIGURED"],
    [403, "SERVICE_DISABLED", "NOT_CONFIGURED"],
    [403, "BILLING_DISABLED", "NOT_CONFIGURED"],
    [429, "QUOTA_EXCEEDED", "RATE_LIMITED"],
    [403, "RATE_LIMIT_EXCEEDED", "RATE_LIMITED"],
  ])("retains only safe ErrorInfo diagnostics for HTTP %i / %s", async (status, errorReason, reason) => {
    global.fetch = jest.fn().mockResolvedValue(response(status, { error: {
      status: "PERMISSION_DENIED", message: "private address server-only-test-key",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "googleapis.com", reason: errorReason,
        metadata: { consumer: "private-project", apiKey: "server-only-test-key" } }],
    } })) as typeof fetch;
    const error = await new GoogleRoutesClient().computeDrivingDistanceMetres("private address").catch(e => e);
    expect(error).toMatchObject({ reason, diagnostics: { httpStatus: status, apiStatus: "PERMISSION_DENIED", errorReason } });
    expect(JSON.stringify(error)).not.toMatch(/private|server-only-test-key/);
  });

  it('does not log arbitrary status/reason/metadata strings supplied by Google', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(400, { error: {
      status: "private address", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "googleapis.com",
        reason: "server-only-test-key", metadata: { private: true } }],
    } })) as typeof fetch;
    const error = await new GoogleRoutesClient().computeDrivingDistanceMetres("private address").catch(e => e);
    expect(error.diagnostics).toEqual({ httpStatus: 400 });
    expect(error.reason).toBe('INVALID_REQUEST');
  });

  it('distinguishes invalid JSON from omitted mandatory destination coordinates', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ...response(200, null), json: async () => { throw new Error('private'); } }) as typeof fetch;
    await expect(new GoogleRoutesClient().computeDrivingDistanceMetres('destination')).rejects.toMatchObject({
      reason: 'MALFORMED_RESPONSE', diagnostics: { httpStatus: 200, responseIssue: 'invalid_json' },
    });
    global.fetch = jest.fn().mockResolvedValue(response(200, { routes: [{ distanceMeters: 6000 }] })) as typeof fetch;
    await expect(new GoogleRoutesClient().computeDrivingDistanceMetres('destination')).rejects.toMatchObject({
      reason: 'MALFORMED_RESPONSE', diagnostics: { httpStatus: 200, responseIssue: 'missing_destination_location' },
    });
  });

  it.each([200, 400])('classifies an abort while reading an HTTP %i body as timeout, not malformed response', async status => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, init) => Promise.resolve(status === 400
      ? new Response(new ReadableStream({ start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new Error('private')));
        } }), { status })
      : { ...response(status, {}),
          json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('private')))),
        })) as typeof fetch;
    const expectation = expect(new GoogleRoutesClient().computeDrivingDistanceMetres('destination')).rejects.toMatchObject({
      reason: 'TIMEOUT', diagnostics: { httpStatus: status },
    });
    await jest.advanceTimersByTimeAsync(GOOGLE_ROUTES_TIMEOUT_MS);
    await expectation;
  });

  it('preserves HTTP classification for a non-JSON provider error', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('<html>private</html>', { status: 503 })) as typeof fetch;
    await expect(new GoogleRoutesClient().computeDrivingDistanceMetres('destination')).rejects.toMatchObject({
      reason: 'PROVIDER_ERROR', diagnostics: { httpStatus: 503, responseIssue: 'invalid_json' },
    });
  });

  it.each([undefined, '1'])('stops an oversized streamed error without trusting Content-Length %s', async contentLength => {
    const cancel = jest.fn();
    const chunk = new Uint8Array(GOOGLE_ROUTES_ERROR_BODY_MAX_BYTES / 2 + 1).fill(65);
    let reads = 0;
    const stream = new ReadableStream({ pull(controller) { reads++; controller.enqueue(chunk); }, cancel }, { highWaterMark: 0 });
    global.fetch = jest.fn().mockResolvedValue(new Response(stream, { status: 400,
      headers: contentLength ? { 'Content-Length': contentLength } : {} })) as typeof fetch;
    const error = await new GoogleRoutesClient().computeDrivingDistanceMetres('private').catch(e => e);
    expect(error).toMatchObject({ reason: 'INVALID_REQUEST', diagnostics: { httpStatus: 400, responseIssue: 'error_body_too_large' } });
    expect(reads).toBe(2); expect(cancel).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error)).not.toContain('AAAA');
  });

  it('rejects oversized Content-Length without reading the body', async () => {
    const cancel = jest.fn(), pull = jest.fn();
    global.fetch = jest.fn().mockResolvedValue(new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
      status: 403, headers: { 'Content-Length': String(GOOGLE_ROUTES_ERROR_BODY_MAX_BYTES + 1) },
    })) as typeof fetch;
    await expect(new GoogleRoutesClient().computeDrivingDistanceMetres('private')).rejects.toMatchObject({
      reason: 'NOT_CONFIGURED', diagnostics: { httpStatus: 403, responseIssue: 'error_body_too_large' },
    });
    expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('accepts exactly the byte limit and handles UTF-8 split across chunks', async () => {
    const base = { error: { status: 'INVALID_ARGUMENT', message: 'é', padding: '' } };
    base.error.padding = ' '.repeat(GOOGLE_ROUTES_ERROR_BODY_MAX_BYTES - Buffer.byteLength(JSON.stringify(base)));
    const bytes = Buffer.from(JSON.stringify(base));
    expect(bytes.byteLength).toBe(GOOGLE_ROUTES_ERROR_BODY_MAX_BYTES);
    const split = bytes.indexOf(Buffer.from('é')) + 1;
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, split)); controller.enqueue(bytes.subarray(split)); controller.close();
    } });
    global.fetch = jest.fn().mockResolvedValue(new Response(stream, { status: 400 })) as typeof fetch;
    await expect(new GoogleRoutesClient().computeDrivingDistanceMetres('destination')).rejects.toMatchObject({
      reason: 'INVALID_REQUEST', diagnostics: { httpStatus: 400, apiStatus: 'INVALID_ARGUMENT' },
    });
  });

  it.each(['null', '[]', '{broken', ''])('retains HTTP status for malformed/non-object error JSON %j', async body => {
    global.fetch = jest.fn().mockResolvedValue(new Response(body, { status: 401 })) as typeof fetch;
    await expect(new GoogleRoutesClient().computeDrivingDistanceMetres('destination')).rejects.toMatchObject({
      reason: 'NOT_CONFIGURED', diagnostics: { httpStatus: 401 },
    });
  });
});
