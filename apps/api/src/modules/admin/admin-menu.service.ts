import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import * as crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  LocalMenuImageStorage,
  type MenuImageStorage,
} from "./menu-image-storage";
import { CatalogCacheService } from "../catalog/catalog-cache.service";
import { WebCatalogRevalidationService } from "../catalog/web-catalog-revalidation.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

// ── DTO types (used by the controller validation classes) ──

export type CreateUpdateItemPayload = {
  name: string;
  description?: string;
  base_price_cents: number;
  category_id: string;
  stock_status: "NORMAL" | "LOW_STOCK" | "UNAVAILABLE";
  is_hidden: boolean;
  is_wing_combo_side?: boolean;
  allowed_fulfillment_type: "BOTH" | "PICKUP" | "DELIVERY";
  modifier_groups?: Array<{ id: string }>;
  removable_ingredients?: Array<{ name: string; sortOrder: number }>;
  additional_ingredients?: Array<{
    name: string;
    price_delta_cents: number;
    matches_ingredient?: string;
  }>;
  schedules?: Array<{
    day_of_week: number;
    time_from: string;
    time_to: string;
  }>;
};

export type CreateUpdateCategoryPayload = {
  name: string;
  sort_order: number;
  is_active: boolean;
  available_from_minutes?: number | null;
  available_until_minutes?: number | null;
};

export type CreateUpdateWingFlavourPayload = {
  name: string;
  category: WingFlavourCategory;
  sort_order: number;
  is_active: boolean;
};

type WingFlavourCategory = "MILD" | "MEDIUM" | "HOT" | "DRY_RUB";
const ALWAYS_AVAILABLE_ADDON_MATCH = "__always__";

// ── Helpers ──

/** Convert "HH:MM" to a Date anchored at 1970-01-01T00:00Z (matches TIME column). */
function hhmmToTimeDate(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m, 0, 0));
}

/** Validate schedule rows and throw if any are invalid. */
function validateScheduleRows(
  rows: Array<{ day_of_week: number; time_from: string; time_to: string }>,
): void {
  for (const row of rows) {
    if (row.day_of_week < 0 || row.day_of_week > 6) {
      throw new BadRequestException(
        `day_of_week must be 0..6, got ${row.day_of_week}`,
      );
    }
    if (!/^\d{2}:\d{2}$/.test(row.time_from) || !/^\d{2}:\d{2}$/.test(row.time_to)) {
      throw new BadRequestException(
        "time_from and time_to must be HH:MM format",
      );
    }
    if (row.time_from >= row.time_to) {
      throw new BadRequestException(
        `time_from (${row.time_from}) must be before time_to (${row.time_to}). Use two rows for overnight windows.`,
      );
    }
  }

  // Check for overlaps within the same day
  const byDay = new Map<number, typeof rows>();
  for (const row of rows) {
    const existing = byDay.get(row.day_of_week) ?? [];
    existing.push(row);
    byDay.set(row.day_of_week, existing);
  }
  for (const [day, dayRows] of byDay) {
    const sorted = [...dayRows].sort((a, b) =>
      a.time_from.localeCompare(b.time_from),
    );
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].time_from < sorted[i - 1].time_to) {
        throw new BadRequestException(
          `Overlapping schedule windows on day ${day}: ${sorted[i - 1].time_from}-${sorted[i - 1].time_to} and ${sorted[i].time_from}-${sorted[i].time_to}`,
        );
      }
    }
  }
}

function normalizeMinuteOfDay(value: unknown, fieldName: string): number | null {
  if (value == null || value === "") return null;
  const minutes =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
    throw new BadRequestException(`${fieldName} must be between 00:00 and 23:59`);
  }
  return minutes;
}

function normalizeIngredientText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCategoryAvailability(data: CreateUpdateCategoryPayload) {
  const availableFromMinutes = normalizeMinuteOfDay(
    data.available_from_minutes,
    "Category available from",
  );
  const availableUntilMinutes = normalizeMinuteOfDay(
    data.available_until_minutes,
    "Category available until",
  );
  if ((availableFromMinutes == null) !== (availableUntilMinutes == null)) {
    throw new BadRequestException(
      "Set both category availability start and end times, or leave both blank",
    );
  }
  return { availableFromMinutes, availableUntilMinutes };
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function normalizeOptionName(name: string): string {
  return name.trim().toLocaleLowerCase("en-CA");
}

function normalizeWingFlavourPosition(requested: number, maximum: number): number {
  if (!Number.isInteger(requested) || requested < 1) {
    throw new BadRequestException("Sauce position must be 1 or greater");
  }
  return Math.min(requested, maximum);
}

// ── Service ──

@Injectable()
export class AdminMenuService {
  private readonly imageStorage: MenuImageStorage;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogCache: CatalogCacheService,
    private readonly webCatalogRevalidation: WebCatalogRevalidationService,
    private readonly realtime: RealtimeGateway,
  ) {
    this.imageStorage = new LocalMenuImageStorage();
  }

  private async invalidateCatalogCaches(locationId: string): Promise<void> {
    await this.catalogCache.invalidateLocation(locationId);
    this.realtime.emitCatalogUpdated(locationId);
    void this.webCatalogRevalidation.revalidateLocation(locationId);
  }

  private async invalidateCatalogAfter<T>(
    locationId: string,
    resultPromise: Promise<T>,
  ): Promise<T> {
    const result = await resultPromise;
    await this.invalidateCatalogCaches(locationId);
    return result;
  }

  private async runWingFlavourTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: "Serializable",
        });
      } catch (error) {
        if ((error as { code?: string }).code !== "P2034" || attempt === 3) {
          throw error;
        }
      }
    }

    throw new ConflictException("Sauce order changed concurrently. Please try again.");
  }

  private async orderedWingFlavourIds(
    tx: Prisma.TransactionClient,
    locationId: string,
    category: WingFlavourCategory,
    excludeId?: string,
  ): Promise<string[]> {
    const flavours = await tx.wingFlavour.findMany({
      where: {
        locationId,
        heatLevel: category,
        archivedAt: null,
        isPlain: false,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: [
        { sortOrder: "asc" },
        { updatedAt: "desc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: { id: true },
    });

    return flavours.map((flavour) => flavour.id);
  }

  private async rewriteWingFlavourOrder(
    tx: Prisma.TransactionClient,
    orderedIds: string[],
  ): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      await tx.wingFlavour.update({
        where: { id },
        data: { sortOrder: index + 1 },
      });
    }
  }

  private async syncWingComboSideOptions(
    tx: Prisma.TransactionClient,
    locationId: string,
    item: {
      id: string;
      name: string;
      isWingComboSide: boolean;
      isAvailable: boolean;
      archivedAt: Date | null;
    },
  ): Promise<void> {
    const sideGroups = await tx.modifierGroup.findMany({
      where: {
        locationId,
        archivedAt: null,
        OR: [
          { contextKey: "side" },
          { menuItems: { some: { contextKey: "side" } } },
        ],
      },
      select: {
        id: true,
        options: {
          orderBy: { sortOrder: "desc" },
          select: {
            id: true,
            name: true,
            linkedMenuItemId: true,
            sortOrder: true,
          },
        },
      },
    });

    const shouldBeActive =
      item.isWingComboSide && item.isAvailable && item.archivedAt === null;
    const normalizedName = normalizeOptionName(item.name);

    for (const group of sideGroups) {
      const linkedOption = group.options.find(
        (option) => option.linkedMenuItemId === item.id,
      );
      const legacyOption = shouldBeActive
        ? group.options.find(
            (option) =>
              option.linkedMenuItemId === null &&
              normalizeOptionName(option.name) === normalizedName,
          )
        : undefined;
      const option = linkedOption ?? legacyOption;

      if (option) {
        await tx.modifierOption.update({
          where: { id: option.id },
          data: {
            name: item.name,
            isActive: shouldBeActive,
            linkedMenuItemId: item.id,
          },
        });
        continue;
      }

      if (!shouldBeActive) continue;

      await tx.modifierOption.create({
        data: {
          modifierGroupId: group.id,
          linkedMenuItemId: item.id,
          name: item.name,
          priceDeltaCents: 0,
          sortOrder: (group.options[0]?.sortOrder ?? 0) + 1,
        },
      });
    }
  }

  // ────────── Categories ──────────

  async listCategories(locationId: string) {
    return this.prisma.menuCategory.findMany({
      where: { locationId, archivedAt: null },
      orderBy: { sortOrder: "asc" },
      include: {
        _count: {
          select: { menuItems: { where: { archivedAt: null } } },
        },
      },
    });
  }

  async createCategory(
    locationId: string,
    data: CreateUpdateCategoryPayload,
  ) {
    const availability = normalizeCategoryAvailability(data);
    const slug = generateSlug(data.name);
    const existing = await this.prisma.menuCategory.findUnique({
      where: { locationId_slug: { locationId, slug } },
    });
    const finalSlug = existing
      ? `${slug}-${crypto.randomBytes(2).toString("hex")}`
      : slug;

    return this.invalidateCatalogAfter(
      locationId,
      this.prisma.menuCategory.create({
        data: {
          locationId,
          name: data.name,
          slug: finalSlug,
          sortOrder: data.sort_order,
          isActive: data.is_active,
          availableFromMinutes: availability.availableFromMinutes,
          availableUntilMinutes: availability.availableUntilMinutes,
        },
      }),
    );
  }

  async updateCategory(
    locationId: string,
    id: string,
    data: CreateUpdateCategoryPayload,
  ) {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id, locationId, archivedAt: null },
    });
    if (!category) throw new NotFoundException("Category not found");
    const availability = normalizeCategoryAvailability(data);

    return this.invalidateCatalogAfter(
      locationId,
      this.prisma.menuCategory.update({
        where: { id },
        data: {
          name: data.name,
          sortOrder: data.sort_order,
          isActive: data.is_active,
          availableFromMinutes: availability.availableFromMinutes,
          availableUntilMinutes: availability.availableUntilMinutes,
          // slug stays stable on rename (v1)
        },
      }),
    );
  }

  async archiveCategory(locationId: string, id: string) {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id, locationId, archivedAt: null },
    });
    if (!category) throw new NotFoundException("Category not found");

    const itemCount = await this.prisma.menuItem.count({
      where: { categoryId: id, archivedAt: null },
    });
    if (itemCount > 0) {
      throw new ConflictException(
        `Cannot archive category "${category.name}" because it still contains ${itemCount} active item(s). Archive or move them first.`,
      );
    }

    return this.invalidateCatalogAfter(
      locationId,
      this.prisma.menuCategory.update({
        where: { id },
        data: { archivedAt: new Date() },
      }),
    );
  }

  // ────────── Modifier Groups (read-only for link/unlink) ──────────

  async listModifierGroups(locationId: string) {
    return this.prisma.modifierGroup.findMany({
      where: { locationId, archivedAt: null },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        displayLabel: true,
        selectionMode: true,
        isRequired: true,
        sortOrder: true,
        contextKey: true,
        options: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            priceDeltaCents: true,
          },
        },
      },
    });
  }

  // ────────── Wing Flavours ──────────

  async listWingFlavours(locationId: string) {
    return this.prisma.wingFlavour.findMany({
      where: { locationId, archivedAt: null, heatLevel: { not: "PLAIN" } },
      orderBy: [
        { sortOrder: "asc" },
        { heatLevel: "asc" },
        { updatedAt: "desc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
    });
  }

  async createWingFlavour(locationId: string, data: CreateUpdateWingFlavourPayload) {
    if ((data as { category?: string }).category === "PLAIN") {
      throw new UnprocessableEntityException("Plain sauce is managed by the system");
    }
    return this.invalidateCatalogAfter(
      locationId,
      this.runWingFlavourTransaction(async (tx) => {
        const slug = generateSlug(data.name);
        const existing = await tx.wingFlavour.findUnique({
          where: { locationId_slug: { locationId, slug } },
        });
        const finalSlug = existing
          ? `${slug}-${crypto.randomBytes(2).toString("hex")}`
          : slug;
        const orderedIds = await this.orderedWingFlavourIds(
          tx,
          locationId,
          data.category,
        );
        const position = normalizeWingFlavourPosition(
          data.sort_order,
          orderedIds.length + 1,
        );
        const created = await tx.wingFlavour.create({
          data: {
            locationId,
            name: data.name,
            slug: finalSlug,
            heatLevel: data.category,
            isPlain: false,
            isActive: data.is_active,
            sortOrder: position,
          },
        });

        orderedIds.splice(position - 1, 0, created.id);
        await this.rewriteWingFlavourOrder(tx, orderedIds);
        return { ...created, sortOrder: position };
      }),
    );
  }

  async updateWingFlavour(locationId: string, id: string, data: CreateUpdateWingFlavourPayload) {
    return this.invalidateCatalogAfter(
      locationId,
      this.runWingFlavourTransaction(async (tx) => {
        const flavour = await tx.wingFlavour.findFirst({
          where: { id, locationId, archivedAt: null },
        });
        if (!flavour) throw new NotFoundException("Sauce not found");
        if (flavour.heatLevel === "PLAIN") {
          throw new UnprocessableEntityException("Plain sauce is managed by the system");
        }

        const destinationIds = await this.orderedWingFlavourIds(
          tx,
          locationId,
          data.category,
          id,
        );
        const position = normalizeWingFlavourPosition(
          data.sort_order,
          destinationIds.length + 1,
        );
        const updated = await tx.wingFlavour.update({
          where: { id },
          data: {
            name: data.name,
            heatLevel: data.category,
            isPlain: false,
            isActive: data.is_active,
            sortOrder: position,
          },
        });

        if (flavour.heatLevel !== data.category) {
          const sourceIds = await this.orderedWingFlavourIds(
            tx,
            locationId,
            flavour.heatLevel as WingFlavourCategory,
            id,
          );
          await this.rewriteWingFlavourOrder(tx, sourceIds);
        }

        destinationIds.splice(position - 1, 0, id);
        await this.rewriteWingFlavourOrder(tx, destinationIds);
        return { ...updated, sortOrder: position };
      }),
    );
  }

  async archiveWingFlavour(locationId: string, id: string) {
    return this.invalidateCatalogAfter(
      locationId,
      this.runWingFlavourTransaction(async (tx) => {
        const flavour = await tx.wingFlavour.findFirst({
          where: { id, locationId, archivedAt: null },
        });
        if (!flavour) throw new NotFoundException("Sauce not found");
        if (flavour.heatLevel === "PLAIN") {
          throw new UnprocessableEntityException("Plain sauce is managed by the system");
        }

        const archived = await tx.wingFlavour.update({
          where: { id },
          data: { archivedAt: new Date(), isActive: false },
        });
        const remainingIds = await this.orderedWingFlavourIds(
          tx,
          locationId,
          flavour.heatLevel as WingFlavourCategory,
          id,
        );
        await this.rewriteWingFlavourOrder(tx, remainingIds);
        return archived;
      }),
    );
  }

  // ────────── Menu Items ──────────

  async listItems(
    locationId: string,
    categoryId?: string,
    query?: string,
  ) {
    const where: Prisma.MenuItemWhereInput = {
      locationId,
      archivedAt: null,
    };
    if (categoryId) where.categoryId = categoryId;
    if (query) where.name = { contains: query, mode: "insensitive" };

    return this.prisma.menuItem.findMany({
      where,
      orderBy: [{ name: "asc" }],
      include: {
        category: true,
        modifierGroups: {
          include: { modifierGroup: true },
        },
      },
    });
  }

  async getItem(locationId: string, id: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, locationId, archivedAt: null },
      include: {
        category: true,
        removableIngredients: { orderBy: { sortOrder: "asc" } },
        schedules: true,
        modifierGroups: {
          orderBy: { sortOrder: "asc" },
          include: {
            modifierGroup: {
              include: {
                options: {
                  where: { isActive: true },
                  orderBy: { sortOrder: "asc" },
                },
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException("Menu item not found");
    return item;
  }

  async createItem(
    locationId: string,
    data: CreateUpdateItemPayload,
  ) {
    // Validate references
    await this.validateCategoryBelongsToLocation(
      locationId,
      data.category_id,
    );
    if (data.modifier_groups?.length) {
      await this.validateModifierGroupsBelongToLocation(
        locationId,
        data.modifier_groups.map((mg) => mg.id),
      );
    }
    if (data.schedules?.length) {
      validateScheduleRows(data.schedules);
    }

    const slug = generateSlug(data.name);
    const existing = await this.prisma.menuItem.findUnique({
      where: { locationId_slug: { locationId, slug } },
    });
    const finalSlug = existing
      ? `${slug}-${crypto.randomBytes(2).toString("hex")}`
      : slug;

    return this.invalidateCatalogAfter(
      locationId,
      this.prisma.$transaction(async (tx) => {
        const item = await tx.menuItem.create({
          data: {
            locationId,
            categoryId: data.category_id,
            name: data.name,
            slug: finalSlug,
            description: data.description ?? null,
            basePriceCents: data.base_price_cents,
            stockStatus: data.stock_status,
            isHidden: data.is_hidden,
            isWingComboSide: data.is_wing_combo_side ?? false,
            isAvailable: data.stock_status !== "UNAVAILABLE",
            allowedFulfillmentType: data.allowed_fulfillment_type,
            removableIngredients: data.removable_ingredients?.length
              ? {
                  create: data.removable_ingredients.map((ri) => ({
                    name: ri.name,
                    sortOrder: ri.sortOrder,
                  })),
                }
              : undefined,
            modifierGroups: data.modifier_groups?.length
              ? {
                  create: data.modifier_groups.map((mg, i) => ({
                    modifierGroupId: mg.id,
                    sortOrder: i,
                  })),
                }
              : undefined,
          },
        });

        if (data.schedules?.length) {
          await tx.menuItemSchedule.createMany({
            data: data.schedules.map((s) => ({
              menuItemId: item.id,
              dayOfWeek: s.day_of_week,
              timeFrom: hhmmToTimeDate(s.time_from),
              timeTo: hhmmToTimeDate(s.time_to),
            })),
          });
        }

        await this.syncWingComboSideOptions(tx, locationId, item);
        if (data.additional_ingredients !== undefined) {
          await this.createAdditionalIngredientsGroup(
            tx,
            locationId,
            item.id,
            item.name,
            data.additional_ingredients,
          );
        }

        return item;
      }),
    );
  }

  async updateItem(
    locationId: string,
    id: string,
    data: CreateUpdateItemPayload,
  ) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, locationId, archivedAt: null },
    });
    if (!item) throw new NotFoundException("Menu item not found");

    await this.validateCategoryBelongsToLocation(
      locationId,
      data.category_id,
    );
    if (data.modifier_groups?.length) {
      await this.validateModifierGroupsBelongToLocation(
        locationId,
        data.modifier_groups.map((mg) => mg.id),
      );
    }
    if (data.schedules?.length) {
      validateScheduleRows(data.schedules);
    }

    return this.invalidateCatalogAfter(
      locationId,
      this.prisma.$transaction(async (tx) => {
        let existingAddonGroupIds: string[] = [];
        if (data.additional_ingredients !== undefined) {
          const existingLinks = await tx.menuItemModifierGroup.findMany({
            where: { menuItemId: id },
            select: {
              modifierGroupId: true,
              contextKey: true,
              modifierGroup: {
                select: { contextKey: true },
              },
            },
          });
          existingAddonGroupIds = existingLinks
            .filter(
              (link) =>
                link.contextKey === "addon" ||
                link.modifierGroup.contextKey === "addon",
            )
            .map((link) => link.modifierGroupId);

          if (
            data.modifier_groups === undefined &&
            existingAddonGroupIds.length > 0
          ) {
            await tx.menuItemModifierGroup.deleteMany({
              where: {
                menuItemId: id,
                modifierGroupId: { in: existingAddonGroupIds },
              },
            });
          }
        }

        // Replace-all: ingredients
        if (data.removable_ingredients) {
          await tx.removableIngredient.deleteMany({
            where: { menuItemId: id },
          });
          if (data.removable_ingredients.length > 0) {
            await tx.removableIngredient.createMany({
              data: data.removable_ingredients.map((ri) => ({
                menuItemId: id,
                name: ri.name,
                sortOrder: ri.sortOrder,
              })),
            });
          }
        }

        // Replace-all: modifier group links
        if (data.modifier_groups) {
          await tx.menuItemModifierGroup.deleteMany({
            where: { menuItemId: id },
          });
          if (data.modifier_groups.length > 0) {
            await tx.menuItemModifierGroup.createMany({
              data: data.modifier_groups.map((mg, i) => ({
                menuItemId: id,
                modifierGroupId: mg.id,
                sortOrder: i,
              })),
            });
          }
        }

        // Replace-all: schedules
        if (data.schedules !== undefined) {
          await tx.menuItemSchedule.deleteMany({
            where: { menuItemId: id },
          });
          if (data.schedules.length > 0) {
            await tx.menuItemSchedule.createMany({
              data: data.schedules.map((s) => ({
                menuItemId: id,
                dayOfWeek: s.day_of_week,
                timeFrom: hhmmToTimeDate(s.time_from),
                timeTo: hhmmToTimeDate(s.time_to),
              })),
            });
          }
        }

        const updatedItem = await tx.menuItem.update({
          where: { id },
          data: {
            name: data.name,
            description: data.description ?? null,
            basePriceCents: data.base_price_cents,
            categoryId: data.category_id,
            stockStatus: data.stock_status,
            isHidden: data.is_hidden,
            isWingComboSide:
              data.is_wing_combo_side ?? item.isWingComboSide,
            isAvailable: data.stock_status !== "UNAVAILABLE",
            allowedFulfillmentType: data.allowed_fulfillment_type,
          },
        });

        await this.syncWingComboSideOptions(tx, locationId, updatedItem);
        if (data.additional_ingredients !== undefined) {
          for (const groupId of existingAddonGroupIds) {
            const remainingLink = await tx.menuItemModifierGroup.findFirst({
              where: { modifierGroupId: groupId },
              select: { modifierGroupId: true },
            });
            if (!remainingLink) {
              await tx.modifierGroup.update({
                where: { id: groupId },
                data: { archivedAt: new Date() },
              });
            }
          }

          await this.createAdditionalIngredientsGroup(
            tx,
            locationId,
            id,
            updatedItem.name,
            data.additional_ingredients,
          );
        }

        return updatedItem;
      }),
    );
  }

  async deleteItem(locationId: string, id: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, locationId, archivedAt: null },
    });
    if (!item) throw new NotFoundException("Menu item not found");

    return this.invalidateCatalogAfter(
      locationId,
      this.prisma.$transaction(async (tx) => {
        const archivedItem = await tx.menuItem.update({
          where: { id },
          data: { archivedAt: new Date() },
        });

        await this.syncWingComboSideOptions(tx, locationId, archivedItem);

        return archivedItem;
      }),
    );
  }

  // ────────── Image management ──────────

  async uploadImage(
    locationId: string,
    id: string,
    file: { buffer: Buffer; originalname?: string },
  ) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, locationId, archivedAt: null },
    });
    if (!item) throw new NotFoundException("Menu item not found");
    if (!file?.buffer) {
      throw new BadRequestException("No image file provided");
    }

    // Remove the old image file if one exists
    if (item.imageUrl) {
      await this.imageStorage.remove(item.imageUrl);
    }

    const imageUrl = await this.imageStorage.save(
      item.slug,
      file.buffer,
      file.originalname ?? "image.jpg",
    );

    await this.prisma.menuItem.update({
      where: { id },
      data: {
        imageUrl,
      },
    });
    await this.invalidateCatalogCaches(locationId);

    return { image_url: imageUrl };
  }

  async uploadBuilderCategoryImage(
    locationId: string,
    categoryId: string,
    file: { buffer: Buffer; originalname?: string },
  ) {
    if (!file?.buffer) {
      throw new BadRequestException("No image file provided");
    }

    const { items } = await this.getBuilderCategoryImageItems(
      locationId,
      categoryId,
    );
    const previousImageUrls = Array.from(
      new Set(
        items
          .map((item) => item.imageUrl)
          .filter((imageUrl): imageUrl is string => Boolean(imageUrl)),
      ),
    );

    const nextImages = await Promise.all(
      items.map(async (item) => ({
        id: item.id,
        imageUrl: await this.imageStorage.save(
          item.slug,
          file.buffer,
          file.originalname ?? "image.jpg",
        ),
      })),
    );

    await this.prisma.$transaction(
      nextImages.map((image) =>
        this.prisma.menuItem.update({
          where: { id: image.id },
          data: { imageUrl: image.imageUrl },
        }),
      ),
    );
    await this.invalidateCatalogCaches(locationId);

    await Promise.all(previousImageUrls.map((url) => this.imageStorage.remove(url)));

    return {
      image_url: nextImages[0]?.imageUrl ?? null,
      updated_count: items.length,
    };
  }

  async getBuilderCategoryImage(locationId: string, categoryId: string) {
    const { items } = await this.getBuilderCategoryImageItems(
      locationId,
      categoryId,
    );
    const ref = items.find((item) => item.imageUrl);
    return {
      image_url: ref?.imageUrl ?? null,
      updated_count: items.length,
    };
  }

  async deleteBuilderCategoryImage(locationId: string, categoryId: string) {
    const { items } = await this.getBuilderCategoryImageItems(
      locationId,
      categoryId,
    );
    const previousImageUrls = Array.from(
      new Set(
        items
          .map((item) => item.imageUrl)
          .filter((imageUrl): imageUrl is string => Boolean(imageUrl)),
      ),
    );

    await this.prisma.menuItem.updateMany({
      where: { id: { in: items.map((item) => item.id) } },
      data: { imageUrl: null },
    });
    await this.invalidateCatalogCaches(locationId);

    await Promise.all(previousImageUrls.map((url) => this.imageStorage.remove(url)));

    return {
      image_url: null,
      updated_count: items.length,
    };
  }

  async deleteImage(locationId: string, id: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, locationId, archivedAt: null },
    });
    if (!item) throw new NotFoundException("Menu item not found");

    if (item.imageUrl) {
      await this.imageStorage.remove(item.imageUrl);
    }

    await this.prisma.menuItem.update({
      where: { id },
      data: { imageUrl: null },
    });
    await this.invalidateCatalogCaches(locationId);

    return { image_url: null };
  }

  // ────────── Validation helpers ──────────

  private async getBuilderCategoryImageItems(
    locationId: string,
    categoryId: string,
  ) {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id: categoryId, locationId, archivedAt: null },
      select: { id: true, slug: true, name: true },
    });
    if (!category) {
      throw new NotFoundException("Category not found");
    }

    const builderType =
      category.slug === "wings"
        ? "WINGS"
        : category.slug === "wing-combos"
          ? "WING_COMBO"
          : null;
    if (!builderType) {
      throw new BadRequestException(
        "Bulk picture upload is only available for Wings by the Pound and Wing Combos",
      );
    }

    const items = await this.prisma.menuItem.findMany({
      where: {
        locationId,
        categoryId,
        builderType,
        archivedAt: null,
      },
      select: { id: true, slug: true, imageUrl: true },
      orderBy: [{ name: "asc" }],
    });
    if (items.length === 0) {
      throw new NotFoundException(`No ${category.name} builder items found`);
    }

    return { category, items };
  }

  private async validateCategoryBelongsToLocation(
    locationId: string,
    categoryId: string,
  ) {
    const cat = await this.prisma.menuCategory.findFirst({
      where: { id: categoryId, locationId, archivedAt: null },
    });
    if (!cat) {
      throw new BadRequestException(
        "Category not found or does not belong to this location",
      );
    }
  }

  private async validateModifierGroupsBelongToLocation(
    locationId: string,
    groupIds: string[],
  ) {
    const count = await this.prisma.modifierGroup.count({
      where: {
        id: { in: groupIds },
        locationId,
        archivedAt: null,
      },
    });
    if (count !== groupIds.length) {
      throw new BadRequestException(
        "One or more modifier groups not found or do not belong to this location",
      );
    }
  }

  private async createAdditionalIngredientsGroup(
    tx: Prisma.TransactionClient,
    locationId: string,
    menuItemId: string,
    itemName: string,
    rows: NonNullable<CreateUpdateItemPayload["additional_ingredients"]>,
  ): Promise<void> {
    const ingredients = rows
      .map((row) => ({
        name: row.name.trim(),
        priceDeltaCents: Math.max(0, row.price_delta_cents),
        addonMatchNormalized: row.matches_ingredient?.trim()
          ? normalizeIngredientText(row.matches_ingredient)
          : ALWAYS_AVAILABLE_ADDON_MATCH,
      }))
      .filter((row) => row.name.length > 0);

    if (ingredients.length === 0) return;

    const group = await tx.modifierGroup.create({
      data: {
        locationId,
        name: `${itemName} Additional Ingredients`,
        displayLabel: "Additional ingredients",
        selectionMode: "MULTI",
        minSelect: 0,
        maxSelect: ingredients.length,
        isRequired: false,
        sortOrder: 30,
        contextKey: "addon",
      },
    });

    await tx.modifierOption.createMany({
      data: ingredients.map((ingredient, index) => ({
        modifierGroupId: group.id,
        name: ingredient.name,
        priceDeltaCents: ingredient.priceDeltaCents,
        isDefault: false,
        isActive: true,
        sortOrder: index + 1,
        addonMatchNormalized: ingredient.addonMatchNormalized,
      })),
    });

    await tx.menuItemModifierGroup.create({
      data: {
        menuItemId,
        modifierGroupId: group.id,
        sortOrder: 30,
        contextKey: "addon",
      },
    });
  }
}
