import { NextRequest } from "next/server";
import { proxyStationApi } from "@/lib/server-station-login-proxy";

type StationRouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function handle(request: NextRequest, context: StationRouteContext) {
  const params = await context.params;
  return proxyStationApi(request, "kds", params.path ?? []);
}

export const GET = handle;
export const POST = handle;
