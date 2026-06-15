"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { toE164 } from "@/lib/phone";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { ApiEnvelope } from "@wings4u/contracts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type CustomerAuthMode = "login" | "signup" | "checkout";

type Step =
  | { name: "signup-form" }
  | { name: "verify-email"; email: string }
  | { name: "login-id" }
  | { name: "login-password"; identifier: string }
  | { name: "reset-request"; identifier: string }
  | { name: "reset-verify"; identifier: string }
  | { name: "profile" }
  | { name: "done" };

type BusyAction =
  | "signup"
  | "verify"
  | "resend"
  | "login"
  | "profile"
  | "reset-request"
  | "reset-confirm"
  | null;

interface Props {
  mode: CustomerAuthMode;
  /** Called when the full auth + profile flow is complete */
  onComplete?: () => void;
  /** Called when user cancels (only relevant in checkout modal) */
  onCancel?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_HINT =
  "Password must be at least 8 characters and include a letter, a number, and a special character.";
const LOGIN_PASSWORD_STEP_STORAGE_KEY = "w4u_login_identifier_pending";

function getPasswordChecks(value: string) {
  return [
    {
      label: `At least 8 characters (${Math.min(value.length, 8)}/8)`,
      met: value.length >= 8,
    },
    { label: "Includes a letter", met: /[A-Za-z]/.test(value) },
    { label: "Includes a number", met: /\d/.test(value) },
    {
      label: "Includes a special character",
      met: /[^A-Za-z0-9]/.test(value),
    },
  ];
}

function stripControlChars(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, "").trim();
}

/** NANP phone: up to 10 digits, formatted as (AAA)-BBB-CCCC while typing. */
function formatPhoneInput(value: string): string {
  const digits = stripControlChars(value).replace(/\D/g, "").slice(0, 10);
  if (digits.length > 6) {
    return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length > 3) {
    return `(${digits.slice(0, 3)})-${digits.slice(3)}`;
  }
  return digits;
}

/** Combined phone-or-email field: slice/format phones; leave email typing alone. */
function formatPhoneOrEmailInput(value: string): string {
  const cleaned = stripControlChars(value);
  if (cleaned.includes("@") || /[a-zA-Z]/.test(cleaned)) {
    return cleaned;
  }
  return formatPhoneInput(cleaned);
}

function isPhoneIdentifier(value: string): boolean {
  return !value.includes("@") && !/[a-zA-Z]/.test(value);
}

function readPendingLoginIdentifier(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(LOGIN_PASSWORD_STEP_STORAGE_KEY);
    return value && value.length <= 254 ? value : null;
  } catch {
    return null;
  }
}

function rememberPendingLoginIdentifier(identifier: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(LOGIN_PASSWORD_STEP_STORAGE_KEY, identifier);
  } catch {
    /* storage can be disabled; login still works without this nicety */
  }
}

function clearPendingLoginIdentifier(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(LOGIN_PASSWORD_STEP_STORAGE_KEY);
  } catch {
    /* storage can be disabled */
  }
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const s = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "1rem",
    padding: "2rem",
    maxWidth: 420,
    margin: "0 auto",
    color: "#fff",
  },
  titleRow: {
    display: "flex",
    flexDirection: "row" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: "0.65rem",
    width: "100%",
    marginBottom: "0.25rem",
  },
  titleBar: {
    flexShrink: 0,
    width: 48,
    height: 1,
    background:
      "linear-gradient(90deg, transparent, rgba(245, 166, 35, 0.7), transparent)",
  },
  title: {
    flex: "1 1 auto",
    minWidth: 0,
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 28,
    letterSpacing: 1.25,
    lineHeight: 1.12,
    margin: 0,
    textAlign: "center" as const,
    color: "#f7e9c8",
    textShadow:
      "0 2px 20px rgba(255, 106, 0, 0.28), 0 0 36px rgba(245, 166, 35, 0.12)",
  },
  subtitle: {
    fontSize: 14,
    color: "#aaa",
    textAlign: "center" as const,
    margin: 0,
  },
  subtitleStrong: {
    color: "#ffd28a",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 13.5,
    letterSpacing: "0.04em",
  },
  loginAsLine: {
    fontSize: 15,
    color: "#aaa",
    textAlign: "center" as const,
    margin: 0,
    lineHeight: 1.4,
  },
  loginIdentifier: {
    display: "block" as const,
    marginTop: "0.4rem",
    color: "#ffd28a",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 26,
    letterSpacing: "0.03em",
    fontVariantNumeric: "tabular-nums" as const,
    lineHeight: 1.2,
    textShadow: "0 0 24px rgba(255, 106, 0, 0.2)",
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.35rem",
  },
  label: {
    fontSize: 13,
    color: "#ccc",
    fontWeight: 600,
  },
  input: {
    padding: "0.65rem 0.75rem",
    borderRadius: 6,
    border: "1px solid #333",
    background: "#111",
    color: "#fff",
    fontSize: 15,
    fontFamily: "'DM Sans', sans-serif",
    outline: "none",
  },
  passwordWrap: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
    width: "100%",
  },
  passwordInput: {
    padding: "0.65rem 0.75rem",
    paddingRight: "2.75rem",
    borderRadius: 6,
    border: "1px solid #333",
    background: "#111",
    color: "#fff",
    fontSize: 15,
    fontFamily: "'DM Sans', sans-serif",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  passwordToggle: {
    position: "absolute" as const,
    right: "0.55rem",
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    padding: 0,
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "#aaa",
    cursor: "pointer",
  },
  hint: {
    fontSize: 12,
    color: "#888",
    margin: 0,
  },
  passwordChecklist: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.35rem 0.75rem",
    margin: "0.1rem 0 0",
    padding: 0,
    listStyle: "none",
  },
  passwordCheckItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    minWidth: 0,
    color: "#858585",
    fontSize: 12,
    lineHeight: 1.25,
  },
  passwordCheckItemMet: {
    color: "#9fe870",
  },
  passwordCheckIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 15,
    height: 15,
    borderRadius: 999,
    border: "1px solid #3a3a3a",
    color: "transparent",
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1,
  },
  passwordCheckIconMet: {
    borderColor: "#9fe870",
    background: "rgba(159, 232, 112, 0.12)",
    color: "#9fe870",
  },
  btn: {
    padding: "0.7rem 1.5rem",
    borderRadius: 6,
    border: "none",
    background: "#f5a623",
    color: "#0a0a0a",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
    letterSpacing: 0.5,
    transition: "opacity 0.15s, transform 0.15s",
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  btnSecondary: {
    padding: "0.5rem 1rem",
    borderRadius: 6,
    border: "1px solid #333",
    background: "transparent",
    color: "#ccc",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
  },
  error: {
    color: "#ff5555",
    fontSize: 13,
    margin: 0,
  },
  link: {
    color: "#f5a623",
    cursor: "pointer",
    textDecoration: "none",
    fontSize: 13,
  },
  linkButton: {
    background: "none",
    border: "none",
    padding: 0,
    color: "#f5a623",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    textDecoration: "underline",
    alignSelf: "center",
  },
  otpInput: {
    textAlign: "center" as const,
    fontSize: 22,
    letterSpacing: 6,
  },
};

const SHAKE_KEYFRAMES = `@keyframes wkBtnShake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-6px); }
  30% { transform: translateX(5px); }
  45% { transform: translateX(-4px); }
  60% { transform: translateX(3px); }
  75% { transform: translateX(-2px); }
  90% { transform: translateX(1px); }
}`;

function AuthHeading({ children }: { children: ReactNode }) {
  return (
    <div className="wk-auth-title-row" style={s.titleRow}>
      <span style={s.titleBar} aria-hidden />
      <h2 style={s.title}>{children}</h2>
      <span style={s.titleBar} aria-hidden />
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div style={s.passwordWrap}>
      <input
        className="wk-password-input"
        style={s.passwordInput}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
      />
      <button
        className="wk-password-toggle"
        type="button"
        style={s.passwordToggle}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {visible ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M1 1l22 22" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul style={s.passwordChecklist} aria-label="Password requirements">
      {getPasswordChecks(value).map((check) => (
        <li
          key={check.label}
          style={{
            ...s.passwordCheckItem,
            ...(check.met ? s.passwordCheckItemMet : {}),
          }}
        >
          <span
            style={{
              ...s.passwordCheckIcon,
              ...(check.met ? s.passwordCheckIconMet : {}),
            }}
            aria-hidden
          >
            ✓
          </span>
          <span>{check.label}</span>
        </li>
      ))}
    </ul>
  );
}

function ResendButton({
  busy,
  sending,
  onClick,
}: {
  busy: boolean;
  sending: boolean;
  onClick: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <button
        type="button"
        className="wk-otp-resend"
        disabled={busy}
        onClick={onClick}
        aria-label="Resend verification code"
      >
        <span className="wk-otp-resend-icon" aria-hidden>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-3.2-6.9" />
            <path d="M21 4v5h-5" />
          </svg>
        </span>
        <span className="wk-otp-resend-label">
          {sending ? "Sending..." : "Resend code"}
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CustomerAuth({ mode, onComplete, onCancel }: Props) {
  const session = useSession();

  const [step, setStep] = useState<Step>(() => {
    if (session.authenticated && session.needsProfileCompletion) {
      return { name: "profile" };
    }
    if (mode === "signup") {
      return { name: "signup-form" };
    }
    const pendingIdentifier = readPendingLoginIdentifier();
    return pendingIdentifier
      ? { name: "login-password", identifier: pendingIdentifier }
      : { name: "login-id" };
  });

  // -- Signup state --
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // -- Login state --
  const [identifier, setIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // -- OTP state --
  const [otpCode, setOtpCode] = useState("");

  // -- Reset state --
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // -- Shared state --
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const busy = busyAction !== null;
  const [shaking, setShaking] = useState(false);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const triggerShake = useCallback(() => {
    setShaking(true);
    clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShaking(false), 450);
  }, []);

  const shakeStyle = shaking ? { animation: "wkBtnShake 0.4s ease" } : {};

  const fail = useCallback(
    (message: string) => {
      setError(message);
      triggerShake();
    },
    [triggerShake],
  );

  const finishAuth = useCallback(
    async (needsProfile: boolean) => {
      await session.refresh();
      if (needsProfile) {
        setStep({ name: "profile" });
      } else {
        setStep({ name: "done" });
        onComplete?.();
      }
    },
    [session, onComplete],
  );

  /* ---------------------------------------------------------------- */
  /*  Signup: create account + send email OTP                         */
  /* ---------------------------------------------------------------- */

  const handleSignup = useCallback(async () => {
    setError("");

    const trimmedName = fullName.trim();
    if (trimmedName.length < 4) return fail("Full name must be at least 4 characters");

    let normalizedPhone: string;
    try {
      normalizedPhone = toE164(phone);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Invalid phone number");
    }

    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail)) return fail("Please enter a valid email address");
    if (!PASSWORD_POLICY.test(password)) return fail(PASSWORD_HINT);
    if (password !== confirmPassword) return fail("Passwords do not match");

    setBusyAction("signup");
    try {
      const res = await apiFetch("/api/v1/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: trimmedName,
          phone: normalizedPhone,
          email: trimmedEmail,
          password,
          confirm_password: confirmPassword,
        }),
      });
      const body = (await res.json()) as ApiEnvelope<{ email: string }>;
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? "Sign up failed");
        return;
      }
      setStep({ name: "verify-email", email: body.data?.email ?? trimmedEmail });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyAction(null);
    }
  }, [fullName, phone, email, password, confirmPassword, fail]);

  /* ---------------------------------------------------------------- */
  /*  Signup: verify email OTP                                        */
  /* ---------------------------------------------------------------- */

  const handleVerifyEmail = useCallback(async () => {
    if (step.name !== "verify-email") return;
    setError("");
    setBusyAction("verify");
    try {
      const res = await apiFetch("/api/v1/auth/signup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: step.email, otp_code: otpCode.trim() }),
      });
      const body = (await res.json()) as ApiEnvelope<{
        needs_profile_completion: boolean;
      }>;
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? "Verification failed");
        return;
      }
      await finishAuth(Boolean(body.data?.needs_profile_completion));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyAction(null);
    }
  }, [step, otpCode, finishAuth]);

  /* ---------------------------------------------------------------- */
  /*  Login: identifier -> password                                   */
  /* ---------------------------------------------------------------- */

  const handleIdentifierContinue = useCallback(() => {
    setError("");
    const value = identifier.trim();
    if (!value) return fail("Please enter your phone or email");
    let normalizedIdentifier: string;
    if (isPhoneIdentifier(value)) {
      const digits = value.replace(/\D/g, "");
      if (digits.length !== 10) {
        return fail("Please enter a valid 10 digit phone number");
      }
      try {
        normalizedIdentifier = toE164(value);
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Invalid phone number");
      }
    } else {
      if (!EMAIL_RE.test(value)) {
        return fail("Please enter a valid phone number or an email address");
      }
      normalizedIdentifier = value.toLowerCase();
    }

    // No account-existence pre-check here: probing whether an identifier is
    // registered is an enumeration vector. Advance straight to the password
    // step; a wrong identifier just fails login with a generic error.
    rememberPendingLoginIdentifier(normalizedIdentifier);
    setLoginPassword("");
    setStep({ name: "login-password", identifier: normalizedIdentifier });
  }, [identifier, fail]);

  const handleLogin = useCallback(async () => {
    if (step.name !== "login-password") return;
    setError("");
    if (!loginPassword) return fail("Please enter your password");

    setBusyAction("login");
    try {
      const res = await apiFetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: step.identifier, password: loginPassword }),
      });
      const body = (await res.json()) as ApiEnvelope<{
        needs_profile_completion: boolean;
        needs_email_verification?: boolean;
        email?: string;
      }>;
      if (!res.ok) {
        const message =
          res.status === 401
            ? "Invalid phone/email or password"
            : body.errors?.[0]?.message ?? "Sign in failed";
        fail(message);
        return;
      }
      // Correct password but the email was never verified: the server emailed a
      // fresh code and withheld the session. Route to email verification.
      if (body.data?.needs_email_verification) {
        setOtpCode("");
        clearPendingLoginIdentifier();
        setStep({ name: "verify-email", email: body.data.email ?? "" });
        return;
      }
      clearPendingLoginIdentifier();
      await finishAuth(Boolean(body.data?.needs_profile_completion));
    } catch (e) {
      fail(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyAction(null);
    }
  }, [step, loginPassword, finishAuth, fail]);

  /* ---------------------------------------------------------------- */
  /*  Password reset                                                  */
  /* ---------------------------------------------------------------- */

  const handleResetRequest = useCallback(async () => {
    if (step.name !== "reset-request") return;
    setError("");
    const value = identifier.trim();
    if (!value) return fail("Please enter your phone or email");
    if (isPhoneIdentifier(value)) {
      const digits = value.replace(/\D/g, "");
      if (digits.length !== 10) {
        return fail("Please enter a valid 10 digit phone number");
      }
    }

    setBusyAction("reset-request");
    try {
      const res = await apiFetch("/api/v1/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: value }),
      });
      const body = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? "Could not send reset code");
        return;
      }
      setOtpCode("");
      setStep({ name: "reset-verify", identifier: value });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyAction(null);
    }
  }, [step, identifier, fail]);

  const handleResetConfirm = useCallback(async () => {
    if (step.name !== "reset-verify") return;
    setError("");
    if (!PASSWORD_POLICY.test(newPassword)) return fail(PASSWORD_HINT);
    if (newPassword !== confirmNewPassword) return fail("Passwords do not match");

    setBusyAction("reset-confirm");
    try {
      const res = await apiFetch("/api/v1/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: step.identifier,
          otp_code: otpCode.trim(),
          new_password: newPassword,
          confirm_password: confirmNewPassword,
        }),
      });
      const body = (await res.json()) as ApiEnvelope<{
        needs_profile_completion: boolean;
      }>;
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? "Could not reset password");
        return;
      }
      await finishAuth(Boolean(body.data?.needs_profile_completion));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyAction(null);
    }
  }, [step, otpCode, newPassword, confirmNewPassword, finishAuth, fail]);

  /* ---------------------------------------------------------------- */
  /*  Resend OTP (signup verify + reset verify)                       */
  /* ---------------------------------------------------------------- */

  const handleResend = useCallback(async () => {
    setError("");
    setBusyAction("resend");
    try {
      if (step.name === "verify-email") {
        const res = await apiFetch("/api/v1/auth/signup/resend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: step.email }),
        });
        const body = (await res.json()) as ApiEnvelope<unknown>;
        if (!res.ok) setError(body.errors?.[0]?.message ?? "Resend failed");
      } else if (step.name === "reset-verify") {
        const res = await apiFetch("/api/v1/auth/password-reset/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: step.identifier }),
        });
        const body = (await res.json()) as ApiEnvelope<unknown>;
        if (!res.ok) setError(body.errors?.[0]?.message ?? "Resend failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyAction(null);
    }
  }, [step]);

  /* ---------------------------------------------------------------- */
  /*  Profile completion (legacy / incomplete accounts)               */
  /* ---------------------------------------------------------------- */

  const profileNameReady = fullName.trim().length >= 4;
  const profileEmailReady = email.trim().length > 0;

  const handleProfileSubmit = useCallback(async () => {
    setError("");
    if (fullName.trim().length < 4) return fail("Full name must be at least 4 characters");
    if (!email.trim()) return fail("Email address is required");

    setBusyAction("profile");
    try {
      const payload: Record<string, string> = { full_name: fullName.trim() };
      if (email.trim()) payload.email = email.trim();

      const res = await withSilentRefresh(
        () =>
          apiFetch("/api/v1/auth/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }),
        session.refresh,
        session.clear,
      );
      const body = (await res.json()) as ApiEnvelope<{ profile_complete: boolean }>;
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? "Profile update failed");
        return;
      }

      await session.refresh();
      setStep({ name: "done" });
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyAction(null);
    }
  }, [fullName, email, session, onComplete, fail]);

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  if (step.name === "done") {
    return (
      <div style={s.container}>
        <style>{SHAKE_KEYFRAMES}</style>
        <AuthHeading>You&apos;re signed in</AuthHeading>
        <p style={s.subtitle}>Welcome back!</p>
      </div>
    );
  }

  /* ---- Signup form ---- */
  if (step.name === "signup-form") {
    return (
      <div style={s.container}>
        <style>{SHAKE_KEYFRAMES}</style>
        <AuthHeading>Create your account</AuthHeading>

        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void handleSignup();
          }}
        >
          <div style={s.field}>
            <label style={s.label}>Full name</label>
            <input
              style={s.input}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </div>

          <div style={s.field}>
            <label style={s.label}>Phone number</label>
            <input
              style={s.input}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="(123)-456-7890"
              maxLength={14}
            />
          </div>

          <div style={s.field}>
            <label style={s.label}>Email</label>
            <input
              style={s.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </div>

          <div style={s.field}>
            <label style={s.label}>Password</label>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <PasswordChecklist value={password} />
          </div>

          <div style={s.field}>
            <label style={s.label}>Confirm password</label>
            <PasswordInput
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Re-enter your password"
              autoComplete="new-password"
            />
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...s.btn, ...(busy ? s.btnDisabled : {}), ...shakeStyle }}
            disabled={busy}
          >
            {busyAction === "signup" ? "Sending..." : "Send verification code"}
          </button>
        </form>

        <p style={s.subtitle}>
          Already have an account?{" "}
          <a href="/login" style={s.link}>
            Sign in
          </a>
        </p>

        {onCancel && (
          <button style={s.btnSecondary} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  /* ---- Login: identifier ---- */
  if (step.name === "login-id") {
    return (
      <div style={s.container}>
        <style>{SHAKE_KEYFRAMES}</style>
        <AuthHeading>
          {mode === "checkout" ? "Sign in to place your order" : "Log into your account"}
        </AuthHeading>

        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void handleIdentifierContinue();
          }}
        >
          <div style={s.field}>
            <label style={s.label}>Phone or email</label>
            <input
              style={s.input}
              type={isPhoneIdentifier(identifier) ? "tel" : "text"}
              inputMode={isPhoneIdentifier(identifier) ? "tel" : "email"}
              value={identifier}
              onChange={(e) => setIdentifier(formatPhoneOrEmailInput(e.target.value))}
              placeholder="(123)-456-7890 or abc@gmail.com"
              autoComplete="username"
              maxLength={isPhoneIdentifier(identifier) ? 14 : undefined}
              autoFocus
            />
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...s.btn, ...(busy ? s.btnDisabled : {}), ...shakeStyle }}
            disabled={busy}
          >
            {busyAction === "login" ? "Continuing..." : "Continue"}
          </button>
        </form>

        <p style={s.subtitle}>
          No account?{" "}
          <a href="/signup" style={s.link}>
            Sign up
          </a>
        </p>

        {onCancel && (
          <button style={s.btnSecondary} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  /* ---- Login: password ---- */
  if (step.name === "login-password") {
    return (
      <div style={s.container}>
        <style>{SHAKE_KEYFRAMES}</style>
        <AuthHeading>Enter your password</AuthHeading>
        <p style={s.loginAsLine}>
          Signing in as
          <span style={s.loginIdentifier}>{step.identifier}</span>
        </p>

        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void handleLogin();
          }}
        >
          <div style={s.field}>
            <label style={s.label}>Password</label>
            <PasswordInput
              value={loginPassword}
              onChange={setLoginPassword}
              placeholder="Your password"
              autoComplete="current-password"
              autoFocus
            />
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...s.btn, ...(busy ? s.btnDisabled : {}), ...shakeStyle }}
            disabled={busy}
          >
            {busyAction === "login" ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          style={s.linkButton}
          disabled={busy}
          onClick={() => {
            setError("");
            setStep({ name: "reset-request", identifier: step.identifier });
          }}
        >
          Forgot password?
        </button>

        <button
          type="button"
          style={s.linkButton}
          disabled={busy}
          onClick={() => {
            setError("");
            setLoginPassword("");
            clearPendingLoginIdentifier();
            setStep({ name: "login-id" });
          }}
        >
          Use a different phone/email
        </button>

        <p style={s.subtitle}>
          No account?{" "}
          <a href="/signup" style={s.link}>
            Sign up
          </a>
        </p>
      </div>
    );
  }

  /* ---- Signup: verify email ---- */
  if (step.name === "verify-email") {
    return (
      <div style={s.container}>
        <AuthHeading>Verify your email</AuthHeading>
        <p style={s.subtitle}>
          We sent a code to <span style={s.subtitleStrong}>{step.email}</span>
        </p>

        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || otpCode.replace(/\D/g, "").length < 4) return;
            void handleVerifyEmail();
          }}
        >
          <div style={s.field}>
            <input
              className="wk-otp-input"
              style={{ ...s.input, ...s.otpInput }}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Code"
              maxLength={6}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              name="otp"
            />
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...s.btn, ...(busy ? s.btnDisabled : {}) }}
            disabled={busy || otpCode.length < 4}
          >
            {busyAction === "verify" ? "Verifying..." : "Verify"}
          </button>
        </form>

        {busyAction !== "verify" && (
          <ResendButton
            busy={busy}
            sending={busyAction === "resend"}
            onClick={handleResend}
          />
        )}
      </div>
    );
  }

  /* ---- Reset: request ---- */
  if (step.name === "reset-request") {
    return (
      <div style={s.container}>
        <style>{SHAKE_KEYFRAMES}</style>
        <AuthHeading>Reset your password</AuthHeading>
        <p style={s.subtitle}>
          Enter your phone or email and we&apos;ll send a reset code to the email on
          file.
        </p>

        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void handleResetRequest();
          }}
        >
          <div style={s.field}>
            <label style={s.label}>Phone or email</label>
            <input
              style={s.input}
              type={isPhoneIdentifier(identifier) ? "tel" : "text"}
              inputMode={isPhoneIdentifier(identifier) ? "tel" : "email"}
              value={identifier}
              onChange={(e) => setIdentifier(formatPhoneOrEmailInput(e.target.value))}
              placeholder="(123)-456-7890 or abc@gmail.com"
              maxLength={isPhoneIdentifier(identifier) ? 14 : undefined}
              autoFocus
            />
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...s.btn, ...(busy ? s.btnDisabled : {}), ...shakeStyle }}
            disabled={busy}
          >
            {busyAction === "reset-request" ? "Sending..." : "Send reset code"}
          </button>
        </form>

        <button
          type="button"
          style={s.btnSecondary}
          disabled={busy}
          onClick={() => {
            setError("");
            setStep({ name: "login-id" });
          }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  /* ---- Reset: verify + new password ---- */
  if (step.name === "reset-verify") {
    return (
      <div style={s.container}>
        <style>{SHAKE_KEYFRAMES}</style>
        <AuthHeading>Set a new password</AuthHeading>
        <p style={s.subtitle}>
          If an account exists for that phone or email, we&apos;ve sent a 6-digit
          code to the email on file. Enter it below to set a new password.
        </p>

        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void handleResetConfirm();
          }}
        >
          <div style={s.field}>
            <label style={s.label}>Verification code</label>
            <input
              className="wk-otp-input"
              style={{ ...s.input, ...s.otpInput }}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Code"
              maxLength={6}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              name="otp"
            />
          </div>

          <div style={s.field}>
            <label style={s.label}>New password</label>
            <PasswordInput
              value={newPassword}
              onChange={setNewPassword}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <PasswordChecklist value={newPassword} />
          </div>

          <div style={s.field}>
            <label style={s.label}>Confirm new password</label>
            <PasswordInput
              value={confirmNewPassword}
              onChange={setConfirmNewPassword}
              placeholder="Re-enter your password"
              autoComplete="new-password"
            />
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...s.btn, ...(busy ? s.btnDisabled : {}), ...shakeStyle }}
            disabled={busy || otpCode.length < 4}
          >
            {busyAction === "reset-confirm" ? "Resetting..." : "Reset password"}
          </button>
        </form>

        {busyAction !== "reset-confirm" && (
          <ResendButton
            busy={busy}
            sending={busyAction === "resend"}
            onClick={handleResend}
          />
        )}
      </div>
    );
  }

  /* ---- Profile completion ---- */
  return (
    <div style={s.container}>
      <style>{SHAKE_KEYFRAMES}</style>
      <AuthHeading>Complete your profile</AuthHeading>
      <p style={s.subtitle}>We need your name to finalize your account.</p>

      <form
        style={{ display: "contents" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && profileNameReady && profileEmailReady) void handleProfileSubmit();
        }}
      >
        <div style={s.field}>
          <label style={s.label}>Full name</label>
          <input
            style={s.input}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jane Doe"
            autoFocus
          />
        </div>

        <div style={s.field}>
          <label style={s.label}>Email</label>
          <input
            style={s.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
            required
          />
        </div>

        {error && <p style={s.error}>{error}</p>}

        <button
          type="submit"
          style={{
            ...s.btn,
            ...(busy || !profileNameReady || !profileEmailReady ? s.btnDisabled : {}),
            ...shakeStyle,
          }}
          disabled={busy || !profileNameReady || !profileEmailReady}
        >
          {busyAction === "profile" ? "Saving..." : "Save and continue"}
        </button>
      </form>
    </div>
  );
}
