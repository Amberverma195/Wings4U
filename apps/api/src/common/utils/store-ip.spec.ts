import { createHmac } from "crypto";
import { getJwtSecret } from "./jwt-secret";
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

  it("uses Railway's client address after validating its private proxy", () => {
    process.env.TRUSTED_PROXY_IP_RANGES = "100.64.0.0/10";

    expect(
      extractClientIp({
        ip: "::ffff:100.64.0.2",
        headers: {
          "x-forwarded-for": "99.242.181.246, 79.127.200.34",
          "x-real-ip": "99.242.181.246",
        },
      }),
    ).toBe("99.242.181.246");
  });

  it("ignores Railway forwarding headers until its proxy is configured", () => {
    delete process.env.TRUSTED_PROXY_IP_RANGES;

    expect(
      extractClientIp({
        ip: "::ffff:100.64.0.2",
        headers: {
          "x-forwarded-for": "99.242.181.246, 79.127.200.34",
          "x-real-ip": "99.242.181.246",
        },
      }),
    ).toBe("100.64.0.2");
  });

  it("does not require Railway CDN addresses when the trusted ingress supplies X-Real-IP", () => {
    process.env.TRUSTED_PROXY_IP_RANGES = "100.64.0.0/10";

    expect(
      extractClientIp({
        ip: "::ffff:100.64.0.23",
        headers: {
          "x-forwarded-for": "64.191.35.67, 152.233.40.2",
          "x-real-ip": "64.191.35.67",
        },
      }),
    ).toBe("64.191.35.67");
  });
});

describe("Client IP trust boundaries", () => {
  afterEach(() => { delete process.env.TRUSTED_PROXY_IP_RANGES; });
  it.each(["198.51.100.5", "2001:db8::5"])("verifies signed forwarding for %s", ip => {
    const signature = createHmac("sha256", getJwtSecret()).update(ip).digest("hex");
    expect(extractClientIp({ socket: { remoteAddress: "203.0.113.1" } as never, headers: { "x-w4u-client-ip": ip, "x-w4u-client-ip-signature": signature } })).toBe(ip);
    expect(extractClientIp({ ip: "203.0.113.1", headers: { "x-w4u-client-ip": ip, "x-w4u-client-ip-signature": "0".repeat(64) } })).toBe("203.0.113.1");
  });
  it("uses socket peer before req.ip to decide which proxy is trusted", () => {
    process.env.TRUSTED_PROXY_IP_RANGES = "10.0.0.0/8";
    expect(extractClientIp({ ip: "10.0.0.1", socket: { remoteAddress: "203.0.113.2" } as never, headers: { "x-forwarded-for": "198.51.100.8" } })).toBe("203.0.113.2");
  });
  it("reads Railway IPv6 real IP without requiring XFF and ignores a forged leftmost XFF", () => {
    process.env.TRUSTED_PROXY_IP_RANGES = "100.64.0.0/10";
    expect(extractClientIp({ ip: "100.64.0.2", headers: { "x-real-ip": "2001:db8::9" } })).toBe("2001:db8::9");
    expect(extractClientIp({ ip: "100.64.0.2", headers: { "x-real-ip": "198.51.100.8", "x-forwarded-for": "attacker, 1.2.3.4" } })).toBe("198.51.100.8");
  });
  it("attributes shared-network clients consistently without trusting caller claims", () => {
    for (const forged of ["198.51.100.8", "2001:db8::3"]) expect(extractClientIp({ ip: "203.0.113.4", headers: { "x-forwarded-for": forged } })).toBe("203.0.113.4");
  });
});
