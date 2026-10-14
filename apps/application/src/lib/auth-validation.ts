import { toE164 } from './phone';

// Keep the customer login rules aligned with web/customer-auth and the API DTOs.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
export const PASSWORD_HINT = 'Password must be at least 8 characters and include a letter, a number, and a special character.';

export function cleanAuthInput(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

export function isPhoneIdentifier(value: string): boolean {
  return !value.includes('@') && !/[a-zA-Z]/.test(value);
}

export function formatPhoneOrEmailInput(value: string): string {
  const cleaned = cleanAuthInput(value);
  if (!isPhoneIdentifier(cleaned)) return cleaned.slice(0, 254);
  const digits = cleaned.replace(/\D/g, '').slice(0, 10);
  if (digits.length > 6) return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length > 3) return `(${digits.slice(0, 3)})-${digits.slice(3)}`;
  return digits;
}

export function normalizeLoginIdentifier(input: string): string {
  const value = cleanAuthInput(input);
  if (!value) throw new Error('Please enter your phone or email');
  if (value.length > 254 || !/^[\w@.+\-() ]+$/.test(value)) {
    throw new Error('Please enter a valid phone number or an email address');
  }
  if (isPhoneIdentifier(value)) {
    const digits = value.replace(/\D/g, '');
    // A normalized identifier can be passed back by the password/reset steps.
    if (value.startsWith('+1') && digits.length === 11) return `+${digits}`;
    if (digits.length !== 10) throw new Error('Please enter a valid 10 digit phone number');
    return toE164(value);
  }
  return normalizeEmail(value);
}

export function normalizeEmail(input: string): string {
  const value = cleanAuthInput(input).toLowerCase();
  if (value.length > 254 || !EMAIL_RE.test(value)) throw new Error('Please enter a valid email address');
  return value;
}

export function validateLoginPassword(password: string): void {
  if (!password) throw new Error('Please enter your password');
  if (password.length > 128) throw new Error('Password must be 128 characters or fewer');
}

export function validateNewPassword(password: string, confirmation: string): void {
  validateLoginPassword(password);
  if (!PASSWORD_POLICY.test(password)) throw new Error(PASSWORD_HINT);
  if (password !== confirmation) throw new Error('Passwords do not match');
}

export function normalizeFullName(input: string): string {
  const value = cleanAuthInput(input);
  if (value.length < 4) throw new Error('Full name must be at least 4 characters');
  if (value.length > 80) throw new Error('Full name must be 80 characters or fewer');
  if (!/^[\p{L}\p{M}\s'.-]+$/u.test(value)) throw new Error('Full name contains invalid characters');
  return value;
}

export function validateOtp(code: string): void {
  if (!/^\d{4,6}$/.test(code)) throw new Error('Verification code must be 4–6 digits');
}
