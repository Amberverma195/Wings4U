import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession } from "@/lib/auth-session";

export default async function AccountLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  const cookieStore = await cookies();
  const session = await resolveSession(cookieStore.get("access_token")?.value);

  if (session?.role === "ADMIN") {
    redirect("/admin");
  }

  if (session?.role === "STAFF") {
    redirect("/kds");
  }

  return <>{children}</>;
}
