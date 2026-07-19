import type { Response } from "express";
import {
  clearSharedCookieVariants,
  getSharedCookieDomain,
  withSharedCookieDomain,
} from "./cookie-domain";

describe("shared cookie domain", () => {
  const originalCookieDomain = process.env.COOKIE_DOMAIN;

  afterEach(() => {
    if (originalCookieDomain === undefined) {
      delete process.env.COOKIE_DOMAIN;
    } else {
      process.env.COOKIE_DOMAIN = originalCookieDomain;
    }
  });

  it("keeps cookies host-only when COOKIE_DOMAIN is unset", () => {
    delete process.env.COOKIE_DOMAIN;

    expect(getSharedCookieDomain()).toBeUndefined();
    expect(withSharedCookieDomain({ path: "/" })).toEqual({ path: "/" });
  });

  it("normalizes the configured parent domain", () => {
    process.env.COOKIE_DOMAIN = "Wings4ULondon.ca";

    expect(getSharedCookieDomain()).toBe(".wings4ulondon.ca");
    expect(withSharedCookieDomain({ path: "/", httpOnly: true })).toEqual({
      path: "/",
      httpOnly: true,
      domain: ".wings4ulondon.ca",
    });
  });

  it("rejects URLs and malformed cookie domains", () => {
    process.env.COOKIE_DOMAIN = "https://wings4ulondon.ca";

    expect(() => getSharedCookieDomain()).toThrow(
      "COOKIE_DOMAIN must be a hostname",
    );
  });

  it("clears shared-domain and old host-only cookie variants", () => {
    process.env.COOKIE_DOMAIN = ".wings4ulondon.ca";
    const clearCookie = jest.fn();
    const response = { clearCookie } as unknown as Response;

    clearSharedCookieVariants(
      response,
      "w4u_kds_session",
      { path: "/", httpOnly: true },
      ["/api/v1/kds"],
    );

    expect(clearCookie).toHaveBeenCalledTimes(4);
    expect(clearCookie).toHaveBeenCalledWith("w4u_kds_session", {
      path: "/",
      httpOnly: true,
      domain: ".wings4ulondon.ca",
    });
    expect(clearCookie).toHaveBeenCalledWith("w4u_kds_session", {
      path: "/",
      httpOnly: true,
    });
    expect(clearCookie).toHaveBeenCalledWith("w4u_kds_session", {
      path: "/api/v1/kds",
      httpOnly: true,
      domain: ".wings4ulondon.ca",
    });
  });
});
