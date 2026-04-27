import { AuthShellSkeleton } from "@/components/auth-shell-skeleton";

/**
 * /login is a server-side redirect to /auth/login. During the redirect
 * handshake the layout's main slot would otherwise be empty for a beat —
 * render the same auth skeleton so users always see continuity if they
 * land here directly (typed URL, external link, stale bookmark).
 */
export default function LoginRedirectLoading() {
  return <AuthShellSkeleton />;
}
