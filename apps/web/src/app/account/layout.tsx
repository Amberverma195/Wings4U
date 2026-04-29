import type { ReactNode } from "react";

export default function AccountLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return <>{children}</>;
}
