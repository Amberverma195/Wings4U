import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { getJwtSecret } from "../../common/utils/jwt-secret";
import {
  DELIVERY_PRICING_RULE_VERSION,
  DELIVERY_QUOTE_SIGNING_CONTEXT,
  FIXED_DELIVERY_QUOTE_SIGNING_CONTEXT,
} from "./delivery-pricing.constants";

export type DeliveryQuotePayload = {
  version: 1;
  location_id: string;
  address_fingerprint: string;
  delivery_fee_cents: number;
  within_delivery_radius: true;
  issued_at: number;
  expires_at: number;
};

function quoteError(
  code: string,
  message: string,
  field = "delivery_quote_token",
): UnprocessableEntityException {
  return new UnprocessableEntityException({ code, message, field });
}

function isDeliveryQuotePayload(value: unknown): value is DeliveryQuotePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    Number.isInteger(payload.version) &&
    typeof payload.location_id === "string" &&
    payload.location_id.length > 0 &&
    typeof payload.address_fingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(payload.address_fingerprint) &&
    Number.isInteger(payload.delivery_fee_cents) &&
    Number(payload.delivery_fee_cents) >= 0 &&
    payload.within_delivery_radius === true &&
    Number.isInteger(payload.issued_at) &&
    Number.isInteger(payload.expires_at)
  );
}

@Injectable()
export class DeliveryQuoteTokenService {
  signDistanceQuote(payload: DeliveryQuotePayload): string {
    return this.sign(payload, DELIVERY_QUOTE_SIGNING_CONTEXT);
  }

  signFixedQuote(payload: DeliveryQuotePayload): string {
    return this.sign(payload, FIXED_DELIVERY_QUOTE_SIGNING_CONTEXT);
  }

  verifyDistanceQuote(token: string): DeliveryQuotePayload {
    const parts = token.split(".");
    if (
      parts.length !== 2 ||
      !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
    ) {
      throw quoteError(
        "INVALID_DELIVERY_QUOTE",
        "The delivery quote is malformed or invalid",
      );
    }

    const [payloadEncoded, signatureEncoded] = parts;
    const expectedSignature = this.signature(
      payloadEncoded,
      DELIVERY_QUOTE_SIGNING_CONTEXT,
    );

    let submitted: Buffer;
    let expected: Buffer;
    try {
      submitted = Buffer.from(signatureEncoded, "base64url");
      expected = Buffer.from(expectedSignature, "base64url");
    } catch {
      throw quoteError(
        "INVALID_DELIVERY_QUOTE",
        "The delivery quote is malformed or invalid",
      );
    }

    if (
      submitted.length !== expected.length ||
      !timingSafeEqual(submitted, expected)
    ) {
      throw quoteError(
        "INVALID_DELIVERY_QUOTE",
        "The delivery quote is malformed or invalid",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8"));
    } catch {
      throw quoteError(
        "INVALID_DELIVERY_QUOTE",
        "The delivery quote is malformed or invalid",
      );
    }

    if (!isDeliveryQuotePayload(parsed)) {
      throw quoteError(
        "INVALID_DELIVERY_QUOTE",
        "The delivery quote is malformed or invalid",
      );
    }
    if (parsed.version !== DELIVERY_PRICING_RULE_VERSION) {
      throw quoteError(
        "UNSUPPORTED_DELIVERY_QUOTE_VERSION",
        "The delivery quote uses an unsupported pricing version",
      );
    }
    if (parsed.within_delivery_radius !== true) {
      throw quoteError(
        "DELIVERY_OUTSIDE_RADIUS",
        "This address is outside the delivery area",
      );
    }
    if (parsed.expires_at <= Date.now()) {
      throw quoteError(
        "DELIVERY_QUOTE_EXPIRED",
        "The delivery quote has expired",
      );
    }

    return parsed;
  }

  private sign(payload: DeliveryQuotePayload, context: string): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${this.signature(encoded, context)}`;
  }

  private signature(payloadEncoded: string, context: string): string {
    return createHmac("sha256", getJwtSecret())
      .update(context, "utf8")
      .update("\0", "utf8")
      .update(payloadEncoded, "utf8")
      .digest("base64url");
  }
}
