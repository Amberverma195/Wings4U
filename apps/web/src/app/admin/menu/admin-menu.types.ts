export type Category = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  _count: { menuItems: number };
};

export type FullMenuItem = {
  id: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  imageUrl: string | null;
  categoryId: string;
  stockStatus: "NORMAL" | "LOW_STOCK" | "UNAVAILABLE";
  isHidden: boolean;
  allowedFulfillmentType: "BOTH" | "PICKUP" | "DELIVERY";
  category: { id: string; name: string };
};
