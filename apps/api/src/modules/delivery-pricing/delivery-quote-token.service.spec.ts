import { DELIVERY_PRICING_RULE_VERSION } from "./delivery-pricing.constants";
import {
  DeliveryQuoteTokenService,
  type DeliveryQuotePayload,
} from "./delivery-quote-token.service";
import { DeliveryQuoteVerifierService } from "./delivery-quote-verifier.service";
import {
  getAddressFingerprint,
  normalizeDeliveryAddress,
} from "./delivery-address";
import { createHmac } from "node:crypto";
import { getJwtSecret } from "../../common/utils/jwt-secret";

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS = {
  line1: "123 Example Street",
  city: "London",
  postal_code: "N5W 3C1",
};

function payload(overrides: Partial<DeliveryQuotePayload> = {}): DeliveryQuotePayload {
  const now = Date.now();
  return {
    version: DELIVERY_PRICING_RULE_VERSION,
    location_id: LOCATION_ID,
    address_fingerprint: getAddressFingerprint(
      normalizeDeliveryAddress(ADDRESS),
    ),
    delivery_fee_cents: 1000,
    within_delivery_radius: true,
    issued_at: now,
    expires_at: now + 60_000,
    ...overrides,
  };
}

describe("delivery quote tokens", () => {
  const originalEnabled = process.env.DELIVERY_DISTANCE_PRICING_ENABLED;
  let tokens: DeliveryQuoteTokenService;
  let verifier: DeliveryQuoteVerifierService;

  beforeEach(() => {
    process.env.DELIVERY_DISTANCE_PRICING_ENABLED = "true";
    tokens = new DeliveryQuoteTokenService();
    verifier = new DeliveryQuoteVerifierService(tokens);
  });

  afterAll(() => {
    process.env.DELIVERY_DISTANCE_PRICING_ENABLED = originalEnabled;
  });

  it("signs and verifies the server-calculated fee", () => {
    const token = tokens.signDistanceQuote(payload());
    expect(
      verifier.verifyForDelivery({
        locationId: LOCATION_ID,
        addressSnapshotJson: ADDRESS,
        deliveryQuoteToken: token,
        required: true,
      }),
    ).toMatchObject({ delivery_fee_cents: 1000 });
  });

  it("rejects tampering", () => {
    const token = tokens.signDistanceQuote(payload());
    const [encoded, signature] = token.split(".");
    const tamperedSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

    expect(() => tokens.verifyDistanceQuote(`${encoded}.${tamperedSignature}`)).toThrow(
      "malformed or invalid",
    );
  });

  it("rejects the wrong location and a changed address", () => {
    const token = tokens.signDistanceQuote(payload());
    expect(() =>
      verifier.verifyForDelivery({
        locationId: "22222222-2222-4222-8222-222222222222",
        addressSnapshotJson: ADDRESS,
        deliveryQuoteToken: token,
        required: true,
      }),
    ).toThrow("different location");
    expect(() =>
      verifier.verifyForDelivery({
        locationId: LOCATION_ID,
        addressSnapshotJson: { ...ADDRESS, line1: "125 Example Street" },
        deliveryQuoteToken: token,
        required: true,
      }),
    ).toThrow("address changed");
  });

  it("rejects expiry and unknown pricing versions", () => {
    expect(() =>
      tokens.verifyDistanceQuote(
        tokens.signDistanceQuote(payload({ expires_at: Date.now() - 1 })),
      ),
    ).toThrow("expired");

    const unknownVersion = {
      ...payload(),
      version: 99,
    } as unknown as DeliveryQuotePayload;
    expect(() =>
      tokens.verifyDistanceQuote(
        tokens.signDistanceQuote(unknownVersion as DeliveryQuotePayload),
      ),
    ).toThrow("unsupported pricing version");
  });

  it("does not accept a fixed-rollout quote after distance pricing is enabled", () => {
    expect(() =>
      tokens.verifyDistanceQuote(tokens.signFixedQuote(payload())),
    ).toThrow("malformed or invalid");
  });

  it.each(["true", "false"])("requires eligibility quotes with distance pricing %s", (enabled) => {
    process.env.DELIVERY_DISTANCE_PRICING_ENABLED = enabled;
    expect(() => verifier.verifyForDelivery({ locationId: LOCATION_ID,
      addressSnapshotJson: ADDRESS, required: true })).toThrow("current delivery quote is required");
    expect(() => verifier.verifyForDelivery({ locationId: LOCATION_ID,
      addressSnapshotJson: ADDRESS, required: true,
      deliveryQuoteToken: tokens.signFixedQuote(payload()) })).toThrow("malformed or invalid");
    // A cart may show an explicitly marked estimate before an address is chosen.
    expect(verifier.verifyForDelivery({ locationId: LOCATION_ID, required: false })).toBeNull();
  });

  it.each(["wings4u.delivery-quote.distance-pricing.v1", "wings4u.delivery-quote.distance-pricing.v2",
    "wings4u.delivery-quote.london-boundary-20km.v2"])("rejects unexpired legacy context %s", context => {
    const encoded = Buffer.from(JSON.stringify(payload())).toString("base64url");
    const signature = createHmac("sha256", getJwtSecret())
      .update(context).update("\0").update(encoded).digest("base64url");
    expect(() => tokens.verifyDistanceQuote(`${encoded}.${signature}`)).toThrow("malformed or invalid");
  });

  it("rejects an old pricing payload even with the current signing context", () => {
    const old = { ...payload(), version: 1 } as unknown as DeliveryQuotePayload;
    expect(() => tokens.verifyDistanceQuote(tokens.signDistanceQuote(old))).toThrow("unsupported pricing version");
  });

  it("rejects editing the signed price in a forged payload", () => {
    const token = tokens.signDistanceQuote(payload());
    const [, signature] = token.split(".");
    const encoded = Buffer.from(JSON.stringify(payload({ delivery_fee_cents: 0 }))).toString("base64url");
    expect(() => tokens.verifyDistanceQuote(`${encoded}.${signature}`)).toThrow("malformed or invalid");
  });
});
