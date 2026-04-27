"use client";

import { useEffect, useState } from "react";
import { createOrdersSocket } from "@/lib/realtime";

export function RealtimeStatusStrip() {
  const [state, setState] = useState<string>("idle");

  useEffect(() => {
    const socket = createOrdersSocket();
    socket.on("connect", () => setState("connected"));
    socket.on("connect_error", () => setState("error"));
    socket.on("disconnect", () => setState("disconnected"));
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <p className="dev-strip">
      WebSocket <code>/ws</code> (Socket.IO): {state}
    </p>
  );
}
