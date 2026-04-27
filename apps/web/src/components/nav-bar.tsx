"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart";

export function NavBar() {
  const { itemCount, isCartHydrating } = useCart();

  return (
    <nav className="nav-bar">
      <Link href="/" className="nav-brand">Wings 4 U</Link>
      <div className="nav-links">
        <Link href="/menu">Menu</Link>
        <Link href="/cart">
          Cart
          {isCartHydrating && itemCount === 0 ? (
            <span className="cart-badge" aria-hidden>
              …
            </span>
          ) : (
            itemCount > 0 && <span className="cart-badge">{itemCount}</span>
          )}
        </Link>
        <Link href="/account/profile">Profile</Link>
        <Link href="/account/orders">Orders</Link>
      </div>
    </nav>
  );
}
