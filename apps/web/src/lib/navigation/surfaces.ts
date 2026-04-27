export type SurfaceLink = {
  href: string;
  label: string;
  summary: string;
};

export const customerSurfaceLinks: SurfaceLink[] = [
  { href: "/", label: "Landing", summary: "Marketing homepage and fulfillment entry point." },
  { href: "/menu", label: "Menu", summary: "Normalized catalog, builders, and menu discovery." },
  { href: "/cart", label: "Cart", summary: "Server-revalidated cart and fulfillment diffs." },
  { href: "/checkout", label: "Checkout", summary: "Pricing engine, promos, wallet, and payment handoff." },
  { href: "/account/orders", label: "My Orders", summary: "Active and past orders, reorder, and support entry points." },
  { href: "/orders/demo-order", label: "Order Tracking", summary: "Realtime customer order status surface." },
  { href: "/catering", label: "Catering", summary: "Inquiry form and confirmation flow." }
];

export const operationsSurfaceLinks: SurfaceLink[] = [
  { href: "/kds", label: "KDS", summary: "Operational execution surface for kitchen and dispatch actions." },
  { href: "/admin", label: "Admin", summary: "Catalog, reporting, support, inventory, and governance surface." },
  { href: "/pos", label: "POS", summary: "Walk-in and phone-order entry surface." },
  { href: "/timeclock", label: "Timeclock", summary: "Clock-in/out, breaks, and shift visibility." },
  { href: "/register", label: "Register", summary: "Drawer, session reconciliation, and receipt flow." },
  { href: "/devices", label: "Devices", summary: "Device and printer tooling route boundary." }
];
