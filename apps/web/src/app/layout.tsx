import type { Metadata, Viewport } from "next";
import { CartProvider } from "@/components/cart-provider";
import { ConnectivityProvider } from "@/components/connectivity-provider";
import { DeliveryAddressProvider } from "@/components/delivery-address-provider";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "@/lib/session";
import { getSiteUrl, SITE_NAME } from "@/lib/seo/site";
import { WingKingsShell } from "@/components/wingkings-shell";
import "./globals.css";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  title: {
    default: "Wings 4 U | Premium Wings, 74+ Sauces & Dry Rubs",
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Enjoy 100% fresh, never frozen chicken wings with over 74+ legendary flavours and dry rubs. Located at 1544 Dundas Street. Order online today!",
  metadataBase: new URL(siteUrl),
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "Wings 4 U | Best Chicken Wings in London, Ontario",
    description:
      "Enjoy 100% fresh, never frozen chicken wings with over 74+ legendary flavours and dry rubs. Located at 1544 Dundas Street. Order online today!",
    url: siteUrl,
    siteName: "Wings 4 U London",
    images: [
      {
        url: "/logo.png",
        width: 512,
        height: 512,
        alt: "Wings 4 U London Official Logo",
      },
    ],
    locale: "en_CA",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Wings 4 U | Fresh Chicken Wings in London, Ontario",
    description:
      "Enjoy 100% fresh chicken wings with over 74+ legendary flavours.",
    images: ["/logo.png"],
  },
  verification: {
    google: "vaJH6PgywqSTELyWHu4cx0ucqaRiHwWXA33G2T5tRiY",
  },
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
