import type { Metadata, Viewport } from "next";
import { CartProvider } from "@/components/cart-provider";
import { ConnectivityProvider } from "@/components/connectivity-provider";
import { DeliveryAddressProvider } from "@/components/delivery-address-provider";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "@/lib/session";
import { WingKingsShell } from "@/components/wingkings-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wings 4 U",
  description: "Premium wings. 70+ sauces and dry rubs. Crispy every time. No excuses.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: extensions (e.g. ColorZilla) inject attrs like cz-shortcut-listen on <body> */}
      <body suppressHydrationWarning>
        <SessionProvider>
          <ConnectivityProvider>
            <CartProvider>
              <DeliveryAddressProvider>
                <WingKingsShell>{children}</WingKingsShell>
              </DeliveryAddressProvider>
            </CartProvider>
          </ConnectivityProvider>
        </SessionProvider>
        <Toaster />
      </body>
    </html>
  );
}
