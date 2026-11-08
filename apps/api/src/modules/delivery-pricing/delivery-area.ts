import { LONDON_BOUNDARY_RINGS } from "./london-boundary";

/** Even/odd polygon test includes the municipal boundary and respects holes. */
export function isWithinLondon(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  let inside = false;
  for (const ring of LONDON_BOUNDARY_RINGS) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const cross = (longitude - xi) * (yj - yi) - (latitude - yi) * (xj - xi);
      if (Math.abs(cross) < 1e-14 &&
          longitude >= Math.min(xi, xj) && longitude <= Math.max(xi, xj) &&
          latitude >= Math.min(yi, yj) && latitude <= Math.max(yi, yj)) return true;
      if ((yi > latitude) !== (yj > latitude) &&
          longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
