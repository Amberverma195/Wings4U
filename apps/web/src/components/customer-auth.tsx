"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { phoneInputPlaceholder, toE164 } from "@/lib/phone";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { ApiEnvelope } from "@wings4u/contracts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type CustomerAuthMode = "login" | "signup" | "checkout";

type Step =
  | { name: "phone" }
  | { name: "otp"; phone: string }
  | { name: "profile"; phone: string }
  | { name: "done" };

interface Props {
  mode: CustomerAuthMode;
  /** Called when the full auth + profile flow is complete */
  onComplete?: () => void;
  /** Called when user cancels (only relevant in checkout modal) */
  onCancel?: () => void;
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
  subtitlePhone: {
    color: "#ffd28a",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 13.5,
    letterSpacing: "0.04em",
    fontVariantNumeric: "tabular-nums" as const,
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
};

function AuthHeading({ children }: { children: ReactNode }) {
  return (
    <div className="wk-auth-title-row" style={s.titleRow}>
      <span style={s.titleBar} aria-hidden />
      <h2 style={s.title}>{children}</h2>
      <span style={s.titleBar} aria-hidden />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CustomerAuth({ mode, onComplete, onCancel }: Props) {
  const session = useSession();

  // If already authenticated but profile incomplete, skip to profile step
  const initialStep: Step =
    session.authenticated && session.needsProfileCompletion
      ? { name: "profile", phone: session.user?.phone ?? "" }
      : { name: "phone" };

  const [step, setStep] = useState<Step>(initialStep);

  // -- Phone step state --
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  // -- OTP step state --
  const [otpCode, setOtpCode] = useState("");

  // -- Shared state --
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const triggerShake = useCallback(() => {
    setShaking(true);
    clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShaking(false), 450);
  }, []);

  const shakeStyle = shaking
    ? { animation: "wkBtnShake 0.4s ease" }
    : {};

  const telPlaceholder = useMemo(
    () => phoneInputPlaceholder(session.user?.phone),
    [session.user?.phone],
  );

  /* ---------------------------------------------------------------- */
  /*  Phone step: request OTP                                         */
  /* ---------------------------------------------------------------- */

  const handlePhoneSubmit = useCallback(async () => {
    setError("");

    if (!phone.trim()) {
      setError("Please enter your phone number");
      triggerShake();
      return;
    }

    let normalized: string;
    try {
      normalized = toE164(phone);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid phone number");
      triggerShake();
      return;
    }

    // Signup mode: check if phone/email already exist before sending OTP
    if (mode === "signup") {
      const trimmedName = fullName.trim();
      if (trimmedName.length < 4) {
        setError("Full name must be at least 4 characters");
        triggerShake();
        return;
      }

      setBusy(true);
      try {
        const checkRes = await apiFetch("/api/v1/auth/check-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: normalized,
            ...(email.trim() ? { email: email.trim() } : {}),
          }),
        });
        const checkBody = (await checkRes.json()) as ApiEnvelope<{
          phone_exists: boolean;
          email_taken: boolean;
        }>;

        if (checkRes.ok && checkBody.data) {
          if (checkBody.data.phone_exists) {
            setError(
              "An account already exists with this phone number. Try signing in.",
            );
            setBusy(false);
            return;
          }
          if (checkBody.data.email_taken) {
            setError("This email is already in use by another account.");
            setBusy(false);
            return;
          }
        }
      } catch {
        // Non-fatal: if the check fails, let the OTP request proceed normally
      }
    } else {
      setBusy(true);
    }

    try {
      const res = await apiFetch("/api/v1/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });
      const body = (await res.json()) as ApiEnvelope<{ otp_sent: boolean }>;
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? "Failed to send OTP");
        return;
      }
      setStep({ name: "otp", phone: normalized });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [phone, mode, fullName, email, triggerShake]);

  /* ---------------------------------------------------------------- */
  /*  OTP step: verify code                                           */
  /* ---------------------------------------------------------------- */

  const handleOtpSubmit = useCallback(async () => {
    if (step.name !== "otp") return;
    setError("");
    setBusy(true);
    try {
      const res = await apiFetch("/api/v1/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: step.phone, otp_code: otpCode.trim() }),
      });
      const body = (await res.json()) as ApiEnvelope<{
        user: { id: string };
        needs_profile_completion: boolean;
      }>;
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? "OTP verification failed");
        return;
      }

      await session.refresh();

      if (body.data?.needs_profile_completion) {
        // For signup mode, pre-fill name/email if entered
        setStep({ name: "profile", phone: step.phone });
      } else {
        setStep({ name: "done" });
        onComplete?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [step, otpCode, session, onComplete]);

  /* ---------------------------------------------------------------- */
  /*  Profile step: complete name (+ optional email)                  */
  /* ---------------------------------------------------------------- */

  const handleProfileSubmit = useCallback(async () => {
    setError("");

    // Client-side name validation
    if (fullName.trim().length < 4) {
      setError("Full name must be at least 4 characters");
      triggerShake();
      return;
    }

    setBusy(true);
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
        const msg = body.errors?.[0]?.message ?? "Profile update failed";
        setError(msg);
        return;
      }

      await session.refresh();
      setStep({ name: "done" });
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [fullName, email, session, onComplete, triggerShake]);

  /* ---------------------------------------------------------------- */
  /*  Resend OTP                                                      */
  /* ---------------------------------------------------------------- */

  const handleResend = useCallback(async () => {
    if (step.name !== "otp") return;
    setError("");
    setBusy(true);
    try {
      const res = await apiFetch("/api/v1/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: step.phone }),
      });
      const body = (await res.json()) as ApiEnvelope<{ otp_sent: boolean }>;
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? "Resend failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [step]);

  /* ---------------------------------------------------------------- */
  /*  Render: done                                                    */
  /* ---------------------------------------------------------------- */

  if (step.name === "done") {
    return (
      <div style={s.container}>
        {/* Shake keyframe injected once */}
        <style>{`@keyframes wkBtnShake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-6px); }
          30% { transform: translateX(5px); }
          45% { transform: translateX(-4px); }
          60% { transform: translateX(3px); }
          75% { transform: translateX(-2px); }
          90% { transform: translateX(1px); }
        }`}</style>
        <AuthHeading>You're signed in</AuthHeading>
        <p style={s.subtitle}>Welcome back!</p>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render: phone step                                              */
  /* ---------------------------------------------------------------- */

  if (step.name === "phone") {
    const isSignup = mode === "signup";
    return (
      <div style={s.container}>
        <style>{`@keyframes wkBtnShake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-6px); }
          30% { transform: translateX(5px); }
          45% { transform: translateX(-4px); }
          60% { transform: translateX(3px); }
          75% { transform: translateX(-2px); }
          90% { transform: translateX(1px); }
        }`}</style>
        <AuthHeading>
          {mode === "checkout"
            ? "Sign in to place your order"
            : isSignup
              ? "Create your account"
              : "Log into your account"}
        </AuthHeading>

        {isSignup && (
          <>
            <div style={s.field}>
              <label style={s.label}>Full name</label>
              <input
                style={s.input}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Email (optional)</label>
              <input
                style={s.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
              />
            </div>
          </>
        )}

        <div style={s.field}>
          <label style={s.label}>Phone number</label>
          <input
            style={s.input}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              let formatted = digits;
              if (digits.length > 6) {
                formatted = `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
              } else if (digits.length > 3) {
                formatted = `(${digits.slice(0, 3)})-${digits.slice(3)}`;
              }
              setPhone(formatted);
            }}
            placeholder="(123)-456-7890"
            maxLength={14}
          />
        </div>

        {error && <p style={s.error}>{error}</p>}

        <button
          style={{ ...s.btn, ...(busy ? s.btnDisabled : {}), ...shakeStyle }}
          onClick={handlePhoneSubmit}
        >
          {busy ? "Sending..." : "Send verification code"}
        </button>

        {mode === "login" && (
          <p style={s.subtitle}>
            No account?{" "}
            <a href="/auth/signup" style={s.link}>
              Sign up
            </a>
          </p>
        )}

        {mode === "signup" && (
          <p style={s.subtitle}>
            Already have an account?{" "}
            <a href="/auth/login" style={s.link}>
              Sign in
            </a>
          </p>
        )}

        {onCancel && (
          <button style={s.btnSecondary} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render: OTP step                                                */
  /* ---------------------------------------------------------------- */

  if (step.name === "otp") {
    return (
      <div style={s.container}>
        <AuthHeading>Enter verification code</AuthHeading>
        <p style={s.subtitle}>
          We sent a code to <span style={s.subtitlePhone}>{step.phone}</span>
        </p>

        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || otpCode.replace(/\D/g, "").length < 4) return;
            void handleOtpSubmit();
          }}
        >
          <div style={s.field}>
            <input
              style={{ ...s.input, textAlign: "center", fontSize: 22, letterSpacing: 6 }}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              name="otp"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (busy || otpCode.replace(/\D/g, "").length < 4) return;
                void handleOtpSubmit();
              }}
            />
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...s.btn, ...(busy ? s.btnDisabled : {}) }}
            disabled={busy || otpCode.length < 4}
          >
            {busy ? "Verifying..." : "Verify"}
          </button>
        </form>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            className="wk-otp-resend"
            disabled={busy}
            onClick={handleResend}
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
              {busy ? "Sending..." : "Resend code"}
            </span>
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render: profile completion step                                 */
  /* ---------------------------------------------------------------- */

  return (
    <div style={s.container}>
      <style>{`@keyframes wkBtnShake {
        0%, 100% { transform: translateX(0); }
        15% { transform: translateX(-6px); }
        30% { transform: translateX(5px); }
        45% { transform: translateX(-4px); }
        60% { transform: translateX(3px); }
        75% { transform: translateX(-2px); }
        90% { transform: translateX(1px); }
      }`}</style>
      <AuthHeading>Complete your profile</AuthHeading>
      <p style={s.subtitle}>We need your name to finalize your account.</p>

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
        <label style={s.label}>Email (optional)</label>
        <input
          style={s.input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@example.com"
        />
      </div>

      {error && <p style={s.error}>{error}</p>}

      <button
        style={{ ...s.btn, ...(busy ? s.btnDisabled : {}), ...shakeStyle }}
        onClick={handleProfileSubmit}
      >
        {busy ? "Saving..." : "Save and continue"}
      </button>
    </div>
  );
}
