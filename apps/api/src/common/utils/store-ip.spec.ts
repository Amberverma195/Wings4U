import { extractClientIp } from "./store-ip";

describe("extractClientIp", () => {
  const originalTrustedProxies = process.env.TRUSTED_PROXY_IP_RANGES;

  afterEach(() => {
    process.env.TRUSTED_PROXY_IP_RANGES = originalTrustedProxies;
  });

  it("ignores caller-controlled forwarding headers from an untrusted peer", () => {
    delete process.env.TRUSTED_PROXY_IP_RANGES;

    expect(
      extractClientIp({
        ip: "203.0.113.10",
        headers: {
          "x-forwarded-for": "198.51.100.1",
          "x-real-ip": "198.51.100.2",
        },
      }),
    ).toBe("203.0.113.10");
  });

  it("uses the nearest untrusted address behind configured proxies", () => {
    process.env.TRUSTED_PROXY_IP_RANGES =
      "10.0.0.0/8,192.0.2.20";

    expect(
      extractClientIp({
        ip: "10.1.2.3",
        headers: {
          "x-forwarded-for": "198.51.100.8, 192.0.2.20, 10.2.3.4",
        },
      }),
    ).toBe("198.51.100.8");
  });
});
