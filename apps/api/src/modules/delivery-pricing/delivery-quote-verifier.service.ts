import { timingSafeEqual } from "node:crypto";
import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import {
  getAddressFingerprint,
  normalizeDeliveryAddress,
} from "./delivery-address";
import {
  type DeliveryQuotePayload,
  DeliveryQuoteTokenService,
} from "./delivery-quote-token.service";
import { isDeliveryDistancePricingEnabled } from "./delivery-pricing.constants";

type VerifyDeliveryQuoteParams = {
  locationId: string;
  addressSnapshotJson?: unknown;
  deliveryQuoteToken?: string;
  required: boolean;
};

function equalFingerprint(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

@Injectable()
export class DeliveryQuoteVerifierService {
  constructor(private readonly tokens: DeliveryQuoteTokenService) {}

  verifyForDelivery(
    params: VerifyDeliveryQuoteParams,
  ): DeliveryQuotePayload | null {
    if (!isDeliveryDistancePricingEnabled()) {
      return null;
    }

    const token = params.deliveryQuoteToken?.trim();
    if (!token) {
      if (!params.required) return null;
      throw new UnprocessableEntityException({
        code: "DELIVERY_QUOTE_REQUIRED",
        message: "A current delivery quote is required",
        field: "delivery_quote_token",
      });
    }

    const payload = this.tokens.verifyDistanceQuote(token);
    if (payload.location_id !== params.locationId) {
      throw new UnprocessableEntityException({
        code: "DELIVERY_QUOTE_LOCATION_MISMATCH",
        message: "The delivery quote was issued for a different location",
        field: "delivery_quote_token",
      });
    }

    const normalizedAddress = normalizeDeliveryAddress(params.addressSnapshotJson);
    const fingerprint = getAddressFingerprint(normalizedAddress);
    if (!equalFingerprint(payload.address_fingerprint, fingerprint)) {
      throw new UnprocessableEntityException({
        code: "DELIVERY_QUOTE_ADDRESS_MISMATCH",
        message: "The delivery address changed after the quote was issued",
        field: "delivery_quote_token",
      });
    }

    return payload;
  }
}
