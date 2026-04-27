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
  const canOpenKds = canAccessSurface(user, "KDS_STAFF_OR_ADMIN");

  if (!canOpenAdmin && !canOpenKds) {
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
      {canOpenKds ? (
        <Link href="/kds" className={navLinkClassName}>
          <span>KDS</span>
          <span className={navLinkArrowClassName}>{"\u2192"}</span>
        </Link>
      ) : null}
    </>
  );
}
