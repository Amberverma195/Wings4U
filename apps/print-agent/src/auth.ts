import type { PrintAgentConfig } from "./config";

export async function loginAsKdsStation(
  config: PrintAgentConfig,
): Promise<string> {
  const url = `${config.apiOrigin.replace(/\/$/, "")}/api/v1/kds/auth/login`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: config.kdsPassword,
      location_id: config.locationId,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `KDS station login failed (${res.status}). Body: ${text || "(empty)"}`,
    );
  }

  const headers = res.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (res.headers.get("set-cookie") ?? "")
          .split(/,(?=\s*[A-Za-z0-9_-]+=)/g)
          .map((cookie) => cookie.trim())
          .filter(Boolean);

  if (setCookies.length === 0) {
    throw new Error(
      "KDS station login succeeded but the API returned no Set-Cookie header.",
    );
  }

  const cookieHeader = setCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((part): part is string => Boolean(part))
    .join("; ");

  return cookieHeader;
}
