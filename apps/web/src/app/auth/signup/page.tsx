"use client";

import { AUTH_FEATURE_BULLETS } from "@/app/auth/auth-feature-bullets";
import { AuthShell } from "@/components/auth-shell";

export default function SignupPage() {
  return (
    <AuthShell
      mode="signup"
      cardAriaLabel="Create your Wings 4 U account"
      headlineRows={[
        { text: "JOIN THE" },
        { text: "FLOCK", accent: true },
      ]}
      subline="Set up once. Order in seconds. Earn perks every time."
      features={[...AUTH_FEATURE_BULLETS]}
    />
  );
}
