const { DEFAULT_LOCATION_ID } = require("../src/lib/env");
const { normalizeCatalogScheduledFor, parseCatalogLocationId } = require("../src/lib/catalog/catalog-route-params");

const NOW = Date.parse("2026-10-21T18:00:30.000Z");

test("accepts a location id or code and rejects arbitrary cache keys", () => {
  expect(parseCatalogLocationId(null)).toBe(DEFAULT_LOCATION_ID);
  expect(parseCatalogLocationId(" lon01 ")).toBe("lon01");
  expect(parseCatalogLocationId("11111111-1111-4111-8111-111111111111")).toBe("11111111-1111-4111-8111-111111111111");
  expect(parseCatalogLocationId("../admin")).toBeNull();
  expect(parseCatalogLocationId("x")).toBeNull();
  expect(parseCatalogLocationId("not a location")).toBeNull();
});

test("collapses equivalent schedule times onto one minute and ignores times outside the ordering horizon", () => {
  const first = normalizeCatalogScheduledFor("2026-10-21T18:05:01.000Z", NOW);
  const later = normalizeCatalogScheduledFor("2026-10-21T18:05:59.000Z", NOW);
  expect(first).toEqual({ ok: true, value: "2026-10-21T18:05:00.000Z" });
  expect(later).toEqual(first);
  expect(normalizeCatalogScheduledFor("not-a-date", NOW)).toEqual({ ok: false });
  expect(normalizeCatalogScheduledFor("2026-10-01T18:00:00.000Z", NOW)).toEqual({ ok: true, value: undefined });
  expect(normalizeCatalogScheduledFor(null, NOW)).toEqual({ ok: true, value: undefined });
});
