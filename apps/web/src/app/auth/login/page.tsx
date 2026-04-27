"use client";

import { AUTH_FEATURE_BULLETS } from "@/app/auth/auth-feature-bullets";
import { AuthShell } from "@/components/auth-shell";

export default function LoginPage() {
  return (
    <AuthShell
      mode="login"
      cardAriaLabel="Sign in to Wings 4 U"
      headlineRows={[
        { text: "WELCOME" },
        { text: "BACK", accent: true },
      ]}
      subline="One number. One code. Straight to the wings."
      features={[...AUTH_FEATURE_BULLETS]}
    />
  );
}
