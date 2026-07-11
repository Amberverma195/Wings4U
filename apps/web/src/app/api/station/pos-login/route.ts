import { NextRequest } from "next/server";
import { proxyStationLogin } from "@/lib/server-station-login-proxy";

export async function POST(request: NextRequest) {
  return proxyStationLogin(request, "/api/v1/pos/auth/login");
}
