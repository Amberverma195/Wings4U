import Link from "next/link";
import { canAccessSurface } from "@/lib/surface-access";
import type { SessionUser } from "@/lib/session";

export function AccountSurfaceLinks({
  user,
  navLinkClassName,
  navLinkArrowClassName,
}: {
  user: SessionUser | null;
  navLinkClassName: string;
  navLinkArrowClassName: string;
}) {
  const canOpenAdmin = canAccessSurface(user, "ADMIN_ONLY");

  if (!canOpenAdmin) {
    return null;
  }

  return (
    <>
      {canOpenAdmin ? (
        <Link href="/admin" className={navLinkClassName}>
          <span>Admin Panel</span>
          <span className={navLinkArrowClassName}>{"\u2192"}</span>
        </Link>
      ) : null}
    </>
  );
}
