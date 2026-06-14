import { BadRequestException } from "@nestjs/common";

/** Strip ASCII control characters and outer whitespace. */
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

/**
 * Reject common SQL/script injection markers in free-text auth fields.
 * Prisma parameterizes queries, but we still refuse obviously malicious input.
 */
const SUSPICIOUS_INPUT =
  /(['";\\]|--|\/\*|\*\/|<\s*script|javascript:|(\b)(union|select|insert|update|delete|drop|exec)(\b))/i;

const EMAIL_LOCAL_RE = /^[a-z0-9._%+-]+$/;
const EMAIL_DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

const FULL_NAME_RE = /^[\p{L}\p{M}\s'.-]+$/u;

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, "").trim();
}

export function assertSafeAuthText(value: string, field: string): void {
  if (SUSPICIOUS_INPUT.test(value)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
}

/** NANP phone → E.164 (+1…). Accepts formatted input; requires exactly 10 digits. */
export function parseNanpPhoneInput(raw: string, field = "phone number"): string {
  const cleaned = stripControlChars(raw);
  assertSafeAuthText(cleaned, field);

  if (!/^[\d\s()+-]+$/.test(cleaned)) {
    throw new BadRequestException(`Invalid ${field}`);
  }

  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  throw new BadRequestException("Please enter a valid 10 digit phone number");
}

/** Normalize and strictly validate an email address for auth lookups. */
export function parseEmailInput(raw: string, field = "email address"): string {
  const cleaned = stripControlChars(raw).toLowerCase();
  assertSafeAuthText(cleaned, field);

  if (!cleaned || cleaned.length > 254) {
    throw new BadRequestException("Please enter a valid email address");
  }

  const at = cleaned.lastIndexOf("@");
  if (at < 1 || at === cleaned.length - 1) {
    throw new BadRequestException("Please enter a valid email address");
  }

  const local = cleaned.slice(0, at);
  const domain = cleaned.slice(at + 1);
  if (!EMAIL_LOCAL_RE.test(local) || !EMAIL_DOMAIN_RE.test(domain)) {
    throw new BadRequestException("Please enter a valid email address");
  }

  return cleaned;
}

/** Login / reset identifier: phone (10-digit NANP) or email. */
export function parseLoginIdentifier(
  raw: string,
): { kind: "phone"; value: string } | { kind: "email"; value: string } {
  const cleaned = stripControlChars(raw);
  if (!cleaned) {
    throw new BadRequestException("Please enter your phone or email");
  }

  if (cleaned.includes("@")) {
    return { kind: "email", value: parseEmailInput(cleaned) };
  }

  if (/[a-zA-Z]/.test(cleaned)) {
    throw new BadRequestException("Please enter a valid email address");
  }

  return { kind: "phone", value: parseNanpPhoneInput(cleaned, "phone or email") };
}

/** Signup / profile display name. */
export function parseFullNameInput(raw: string): string {
  const cleaned = stripControlChars(raw);
  assertSafeAuthText(cleaned, "full name");

  if (cleaned.length < 4 || cleaned.length > 80) {
    throw new BadRequestException("Full name must be at least 4 characters");
  }
  if (!FULL_NAME_RE.test(cleaned)) {
    throw new BadRequestException("Full name contains invalid characters");
  }

  return cleaned;
}

/** OTP codes: digits only, fixed length window enforced by callers. */
export function parseOtpCodeInput(raw: string): string {
  const cleaned = stripControlChars(raw);
  if (!/^\d{4,8}$/.test(cleaned)) {
    throw new BadRequestException("Invalid verification code");
  }
  return cleaned;
}
