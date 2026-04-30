"use client";

import type { ReactNode } from "react";
import { CartContext, useCartState } from "@/lib/cart";
import { DEFAULT_LOCATION_ID } from "@/lib/env";

export function CartProvider({ children }: { children: ReactNode }) {
  const cart = useCartState(DEFAULT_LOCATION_ID);
  return (
    <CartContext.Provider value={cart}>
      {children}
    </CartContext.Provider>
  );
}
