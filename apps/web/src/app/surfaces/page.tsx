"use client";

import Link from "next/link";
import { ApiHealthStrip } from "@/components/dev/api-health";
import { RealtimeStatusStrip } from "@/components/dev/realtime-status";
import { customerSurfaceLinks, operationsSurfaceLinks } from "@/lib/navigation/surfaces";
import { useSession } from "@/lib/session";
import { canAccessSurface } from "@/lib/surface-access";

export default function SurfacesPage() {
  const session = useSession();
  const authorizedOperationsLinks = operationsSurfaceLinks.filter((link) => {
    if (link.href === "/admin") {
      return canAccessSurface(session.user, "ADMIN_ONLY");
    }
    if (link.href === "/kds") {
      return canAccessSurface(session.user, "KDS_STAFF_OR_ADMIN");
    }
    if (link.href === "/pos") {
      return canAccessSurface(session.user, "POS_STAFF_OR_ADMIN");
    }
    return false;
  });

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="page-eyebrow">Wings 4 U - Web</p>
        <h1>Wings 4 U platform surfaces</h1>
        <p>
          Customer and operations routes call the Nest API at <code>/api/v1</code> (proxied in dev)
          and may subscribe to realtime events over Socket.IO at <code>/ws</code> on the API host.
        </p>
        <ApiHealthStrip />
        <RealtimeStatusStrip />

        <div className="surface-grid">
          {customerSurfaceLinks.map((link) => (
            <Link className="surface-link" href={link.href} key={link.href}>
              <h2>{link.label}</h2>
              <p>{link.summary}</p>
            </Link>
          ))}
        </div>

        {session.loaded && authorizedOperationsLinks.length > 0 ? (
          <div className="surface-grid">
            {authorizedOperationsLinks.map((link) => (
              <Link className="surface-link" href={link.href} key={link.href}>
                <h2>{link.label}</h2>
                <p>{link.summary}</p>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
