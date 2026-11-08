import {
  GoogleRoutesClient,
  GoogleRoutesClientError,
} from "./google-routes.client";
import {
  GOOGLE_ROUTES_TIMEOUT_MS,
  GOOGLE_ROUTES_URL,
  RESTAURANT_ORIGIN,
} from "./delivery-pricing.constants";

const originalFetch = global.fetch;
const originalApiKey = process.env.GOOGLE_MAPS_ROUTES_API_KEY;

function response(status: number, body: unknown): Response {
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
});
