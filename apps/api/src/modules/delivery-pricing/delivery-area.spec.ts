import { isWithinLondon } from "./delivery-area";
import { LONDON_BOUNDARY_RINGS } from "./london-boundary";

describe("City of London municipal delivery boundary", () => {
  it.each([
    [42.9998852, -81.1943749], // Restaurant
    [42.953, -81.327], // Byron / N6K
    [43.022, -81.305], // Northwest London
    [42.941, -81.228], // South London
  ])("includes London at %s, %s", (lat, lng) => {
    expect(isWithinLondon(lat, lng)).toBe(true);
  });

  it.each([
    [43.01, -81.09], // Thames Centre, close enough that distance alone is insufficient
    [42.96, -81.4], // Middlesex Centre
    [42.78, -81.18], // St. Thomas
    [51.5074, -0.1278], // London, UK
    [NaN, -81.2],
  ])("excludes non-London at %s, %s", (lat, lng) => {
    expect(isWithinLondon(lat, lng)).toBe(false);
  });

  it("includes a point exactly on the municipal boundary", () => {
    const [lng, lat] = LONDON_BOUNDARY_RINGS[0][0];
    expect(isWithinLondon(lat, lng)).toBe(true);
  });
});
