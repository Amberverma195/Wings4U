import { UnprocessableEntityException } from "@nestjs/common";

export function phoneDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function deliveryPinFromPhone(value: string | null | undefined): string | null {
  const digits = phoneDigits(value);
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function requireDeliveryPinFromPhone(
  value: string | null | undefined,
  field = "customer_phone_snapshot",
): string {
  const pin = deliveryPinFromPhone(value);
  if (!pin) {
    throw new UnprocessableEntityException({
      message: "Delivery orders require a valid customer phone number for PIN verification",
      field,
    });
  }
  return pin;
}

export function normalizeNanpDeliveryPhone(
  value: string | null | undefined,
  field = "customer_phone",
): string {
  const digits = phoneDigits(value);
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  throw new UnprocessableEntityException({
    message: "Delivery orders require a valid 10-digit customer phone number",
    field,
  });
}
