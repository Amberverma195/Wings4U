export function assertLocationScope(requestLocationId: string, actorLocationId: string) {
  if (requestLocationId !== actorLocationId) {
    throw new Error("Location scope mismatch.");
  }
}
