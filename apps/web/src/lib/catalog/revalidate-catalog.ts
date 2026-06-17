/**
 * Ask the Next.js app to drop cached catalog responses after admin menu edits.
 * Safe to call from the browser; the route handler validates a server secret.
 */
export async function requestCatalogRevalidation(locationId?: string): Promise<void> {
  try {
    await fetch("/api/revalidate/catalog", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ locationId }),
    });
  } catch {
    // Best-effort; Redis/API cache is still invalidated server-side.
  }
}
