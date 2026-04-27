"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";

type HealthData = { status: string };

export function ApiHealthStrip() {
  const [health, setHealth] = useState<string>("…");
  const [requestId, setRequestId] = useState<string>("");

  useEffect(() => {
    void (async () => {
      try {
        const env = await apiJson<HealthData>("/api/v1/health");
        setHealth(env.data?.status ?? "unknown");
        setRequestId(env.meta.request_id);
      } catch {
        setHealth("unreachable");
      }
    })();
  }, []);

  return (
    <p className="dev-strip">
      API <code>/api/v1/health</code>: {health}
      {requestId ? (
        <>
          {" "}
          · <code>request_id</code> {requestId.slice(0, 8)}…
        </>
      ) : null}
    </p>
  );
}
