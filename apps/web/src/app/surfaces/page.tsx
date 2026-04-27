import Link from "next/link";
import { ApiHealthStrip } from "@/components/dev/api-health";
import { RealtimeStatusStrip } from "@/components/dev/realtime-status";
import { customerSurfaceLinks, operationsSurfaceLinks } from "@/lib/navigation/surfaces";

export default function SurfacesPage() {
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

        <div className="surface-grid">
          {operationsSurfaceLinks.map((link) => (
            <Link className="surface-link" href={link.href} key={link.href}>
              <h2>{link.label}</h2>
              <p>{link.summary}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}