import { NextRequest } from "next/server";
import { proxyStoreNetworkApi } from "@/lib/server-station-login-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyStoreNetworkApi(request);
}

export async function POST(request: NextRequest) {
  return proxyStoreNetworkApi(request);
}

export async function PUT(request: NextRequest) {
  return proxyStoreNetworkApi(request);
}

export async function PATCH(request: NextRequest) {
  return proxyStoreNetworkApi(request);
}

export async function DELETE(request: NextRequest) {
  return proxyStoreNetworkApi(request);
}
