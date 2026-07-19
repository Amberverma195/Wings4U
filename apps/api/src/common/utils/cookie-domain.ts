import type { CookieOptions, Response } from "express";

const COOKIE_DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export function getSharedCookieDomain(): string | undefined {
  const configured = process.env.COOKIE_DOMAIN?.trim();
  if (!configured) return undefined;

  const hostname = configured.replace(/^\./, "");
  if (!COOKIE_DOMAIN_PATTERN.test(hostname)) {
    throw new Error(
      "COOKIE_DOMAIN must be a hostname such as .wings4ulondon.ca",
    );
  }

  return `.${hostname.toLowerCase()}`;
}

export function withSharedCookieDomain(
  options: CookieOptions,
): CookieOptions {
  const domain = getSharedCookieDomain();
  return domain ? { ...options, domain } : options;
}

export function clearSharedCookieVariants(
  response: Response,
  name: string,
  options: CookieOptions,
  legacyPaths: readonly string[] = [],
): void {
  const domain = getSharedCookieDomain();
  const paths = [options.path, ...legacyPaths].filter(
    (path): path is string => typeof path === "string" && path.length > 0,
  );

  for (const path of new Set(paths)) {
    const pathOptions = { ...options, path };
    if (domain) {
      response.clearCookie(name, { ...pathOptions, domain });
    }
    response.clearCookie(name, pathOptions);
  }
}
