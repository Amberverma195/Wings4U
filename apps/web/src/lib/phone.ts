/**
 * Normalize user-entered phone text to E.164 (matches server `normalizePhone`).
 * - Strips spaces, dashes, parentheses; keeps leading +.
 * - 10-digit NANP (US/Canada) without + → +1…
 * - 11-digit starting with 1 without + → +1…
 */
export function toE164(input: string): string {
  const trimmed = input.trim();

  const digitsOnly = trimmed.replace(/\D/g, "");

  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }

  throw new Error("Please Enter a valid 10 digit Phone Number");
}

const DEFAULT_PHONE_PLACEHOLDER = "+1 (123)-456-7890 ";

/**
 * Tel input placeholder: default sample, or NANP digits from session `phone` (E.164 or 10-digit)
 * formatted as `+1 (AAA) BBB-CCCC `.
 */
export function phoneInputPlaceholder(phoneE164OrDigits: string | undefined | null): string {
  const digits = String(phoneE164OrDigits ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)})-${digits.slice(4, 7)}-${digits.slice(7, 11)} `;
  }
  if (digits.length === 10) {
    return `+1 (${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6, 10)} `;
  }
  return DEFAULT_PHONE_PLACEHOLDER;
}
