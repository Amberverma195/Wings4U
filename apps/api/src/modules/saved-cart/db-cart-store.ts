import { Injectable } from "@nestjs/common";
import { Prisma, SavedCartStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import type { CartStore } from "./cart-store.interface";
import {
  GUEST_CART_TTL_MS,
  type CartIdentity,
  type CartItemSnapshot,
  type CartSnapshot,
  type DriverTipPercentSnapshot,
  type ModifierSelectionSnapshot,
  type RemovedIngredientSnapshot,
} from "./saved-cart.types";

type CartWithItems = Prisma.SavedCartGetPayload<{
  include: { items: true };
}>;

@Injectable()
export class DbCartStore implements CartStore {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(
    identity: CartIdentity,
    locationId: string,
  ): Promise<CartSnapshot | null> {
    const cart = await this.findActive(this.prisma, identity, locationId);
    if (!cart) return null;
    if (identity.kind === "guest") {
      await this.extendGuestExpiry(this.prisma, cart.id);
    }
    return toSnapshot(cart, identity.kind === "guest");
  }

  async saveSnapshot(
    identity: CartIdentity,
    locationId: string,
    snapshot: Omit<CartSnapshot, "expires_at" | "is_guest">,
  ): Promise<CartSnapshot> {
    const cart = await this.prisma.$transaction(async (tx) => {
      const existing = await this.findActive(tx, identity, locationId);
      const nowPlusTtl = new Date(Date.now() + GUEST_CART_TTL_MS);
      const metadata = {
        fulfillmentType: snapshot.fulfillment_type,
        locationTimezone: snapshot.location_timezone,
        scheduledFor: snapshot.scheduled_for ? new Date(snapshot.scheduled_for) : null,
        driverTipPercent: snapshot.driver_tip_percent,
      };

      if (existing) {
        await tx.savedCartItem.deleteMany({ where: { cartId: existing.id } });
        if (snapshot.items.length > 0) {
          await tx.savedCartItem.createMany({
            data: snapshot.items.map((item, index) => toItemCreateRow(existing.id, item, index)),
          });
        }
        return tx.savedCart.update({
          where: { id: existing.id },
          data: {
            ...metadata,
            ...(identity.kind === "guest" ? { expiresAt: nowPlusTtl } : {}),
          },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
      }

      return tx.savedCart.create({
        data: {
          userId: identity.kind === "user" ? identity.userId : null,
          guestToken: identity.kind === "guest" ? identity.guestToken : null,
          locationId,
          ...metadata,
          status: SavedCartStatus.ACTIVE,
          expiresAt: identity.kind === "guest" ? nowPlusTtl : null,
          items: {
            create: snapshot.items.map((item, index) => toItemNestedCreate(item, index)),
          },
        },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
    });

    return toSnapshot(cart, identity.kind === "guest");
  }

  async clear(identity: CartIdentity, locationId: string): Promise<void> {
    const existing = await this.findActive(this.prisma, identity, locationId);
    if (!existing) return;
    // Phase 4: Mark as CONVERTED instead of delete for checkout history.
    await this.markConverted(identity, locationId);
  }

  async markConverted(identity: CartIdentity, locationId: string): Promise<void> {
    const existing = await this.findActive(this.prisma, identity, locationId);
    if (!existing) return;
    await this.prisma.savedCart.update({
      where: { id: existing.id },
      data: { status: SavedCartStatus.CONVERTED },
    });
  }

  async mergeGuestIntoUser(
    guestToken: string,
    userId: string,
    locationId: string,
  ): Promise<{
    snapshot: CartSnapshot | null;
    mergeOutcome: "merged" | "kept_both" | "no_guest";
  }> {
    return this.prisma.$transaction(async (tx) => {
      const guestCart = await tx.savedCart.findFirst({
        where: { guestToken, status: SavedCartStatus.ACTIVE },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });

      if (!guestCart) {
        const userCart = await this.findActive(tx, { kind: "user", userId }, locationId);
        return {
          snapshot: userCart ? toSnapshot(userCart, false) : null,
          mergeOutcome: "no_guest" as const,
        };
      }

      // Guest cart exists but at a different location: leave it alone,
      // return the user's cart for the *current* location.
      if (guestCart.locationId !== locationId) {
        const userCart = await this.findActive(tx, { kind: "user", userId }, locationId);
        return {
          snapshot: userCart ? toSnapshot(userCart, false) : null,
          mergeOutcome: "kept_both" as const,
        };
      }

      // Same location: merge items by lineKey (sum quantities on collisions,
      // add guest-only lines). Write the merged set to the user cart, then
      // delete the guest cart so we never merge the same items twice.
      const userCart = await this.findActive(tx, { kind: "user", userId }, locationId);
      const mergedItems = mergeItemsByLineKey(
        userCart?.items.map(rowToSnapshotItem) ?? [],
        guestCart.items.map(rowToSnapshotItem),
      );

      const metadata = {
        fulfillmentType: (userCart?.fulfillmentType ?? guestCart.fulfillmentType),
        locationTimezone: userCart?.locationTimezone ?? guestCart.locationTimezone,
        scheduledFor: userCart?.scheduledFor ?? guestCart.scheduledFor,
        driverTipPercent: userCart?.driverTipPercent ?? guestCart.driverTipPercent,
      };

      let savedUserCart: CartWithItems;
      if (userCart) {
        await tx.savedCartItem.deleteMany({ where: { cartId: userCart.id } });
        if (mergedItems.length > 0) {
          await tx.savedCartItem.createMany({
            data: mergedItems.map((item, index) => toItemCreateRow(userCart.id, item, index)),
          });
        }
        savedUserCart = await tx.savedCart.update({
          where: { id: userCart.id },
          data: metadata,
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
      } else {
        savedUserCart = await tx.savedCart.create({
          data: {
            userId,
            locationId,
            ...metadata,
            status: SavedCartStatus.ACTIVE,
            items: {
              create: mergedItems.map((item, index) => toItemNestedCreate(item, index)),
            },
          },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
      }

      await tx.savedCart.delete({ where: { id: guestCart.id } });

      return {
        snapshot: toSnapshot(savedUserCart, false),
        mergeOutcome: "merged" as const,
      };
    });
  }

  private async findActive(
    tx: Prisma.TransactionClient | PrismaService,
    identity: CartIdentity,
    locationId: string,
  ): Promise<CartWithItems | null> {
    const identityWhere =
      identity.kind === "user"
        ? { userId: identity.userId, guestToken: null }
        : { guestToken: identity.guestToken, userId: null };

    return tx.savedCart.findFirst({
      where: {
        ...identityWhere,
        locationId,
        status: SavedCartStatus.ACTIVE,
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  }

  private async extendGuestExpiry(
    tx: Prisma.TransactionClient | PrismaService,
    cartId: string,
  ): Promise<void> {
    // Sliding TTL: every read bumps expiry to now + 7d. Prevents active
    // guests from losing their cart while the expiry job is free to clean
    // up truly abandoned ones.
    await tx.savedCart.update({
      where: { id: cartId },
      data: { expiresAt: new Date(Date.now() + GUEST_CART_TTL_MS) },
    });
  }
}

function toSnapshot(cart: CartWithItems, isGuest: boolean): CartSnapshot {
  return {
    items: cart.items.map(rowToSnapshotItem),
    fulfillment_type: cart.fulfillmentType,
    location_timezone: cart.locationTimezone,
    scheduled_for: cart.scheduledFor ? cart.scheduledFor.toISOString() : null,
    driver_tip_percent: normalizeDriverTip(cart.driverTipPercent),
    expires_at: cart.expiresAt ? cart.expiresAt.toISOString() : null,
    is_guest: isGuest,
  };
}

function rowToSnapshotItem(row: CartWithItems["items"][number]): CartItemSnapshot {
  return {
    key: row.lineKey,
    menu_item_id: row.menuItemId,
    menu_item_slug: row.menuItemSlug,
    name: row.nameSnapshot,
    image_url: row.imageUrl,
    base_price_cents: row.basePriceCents,
    quantity: row.quantity,
    modifier_selections: parseModifierSelections(row.modifierSelectionsJson),
    removed_ingredients: parseRemovedIngredients(row.removedIngredientsJson),
    special_instructions: row.specialInstructions,
    builder_payload: row.builderPayloadJson as Record<string, unknown> | null,
  };
}

function toItemCreateRow(cartId: string, item: CartItemSnapshot, index: number) {
  return {
    cartId,
    menuItemId: item.menu_item_id,
    menuItemSlug: item.menu_item_slug,
    nameSnapshot: item.name,
    imageUrl: item.image_url,
    basePriceCents: item.base_price_cents,
    quantity: item.quantity,
    specialInstructions: item.special_instructions ?? "",
    modifierSelectionsJson: (item.modifier_selections ?? []) as unknown as Prisma.InputJsonValue,
    removedIngredientsJson: (item.removed_ingredients ?? []) as unknown as Prisma.InputJsonValue,
    builderPayloadJson:
      item.builder_payload == null
        ? Prisma.JsonNull
        : (item.builder_payload as unknown as Prisma.InputJsonValue),
    lineKey: item.key,
    sortOrder: index,
  };
}

function toItemNestedCreate(item: CartItemSnapshot, index: number) {
  const row = toItemCreateRow("", item, index);
  // Nested create is scoped by the parent, so we drop the cartId field.
  const { cartId: _cartId, ...rest } = row;
  return rest;
}

function mergeItemsByLineKey(
  base: CartItemSnapshot[],
  incoming: CartItemSnapshot[],
): CartItemSnapshot[] {
  const byKey = new Map<string, CartItemSnapshot>();
  for (const item of base) byKey.set(item.key, { ...item });
  for (const item of incoming) {
    const existing = byKey.get(item.key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      byKey.set(item.key, { ...item });
    }
  }
  return Array.from(byKey.values());
}

function parseModifierSelections(raw: unknown): ModifierSelectionSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isModifierSelection);
}

function parseRemovedIngredients(raw: unknown): RemovedIngredientSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRemovedIngredient);
}

function isModifierSelection(value: unknown): value is ModifierSelectionSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.modifier_option_id === "string" &&
    typeof v.group_name === "string" &&
    typeof v.option_name === "string" &&
    typeof v.price_delta_cents === "number"
  );
}

function isRemovedIngredient(value: unknown): value is RemovedIngredientSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.name === "string";
}

function normalizeDriverTip(raw: string): DriverTipPercentSnapshot {
  if (raw === "10" || raw === "15" || raw === "20") return raw;
  return "none";
}
