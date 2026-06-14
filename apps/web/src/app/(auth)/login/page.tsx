"use client";

import { AUTH_FEATURE_BULLETS } from "@/components/auth-feature-bullets";
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
      subline="Sign in with your phone or email and password."
      features={[...AUTH_FEATURE_BULLETS]}
    />
  );
}
