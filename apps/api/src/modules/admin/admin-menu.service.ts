import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import * as crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  LocalMenuImageStorage,
  type MenuImageStorage,
} from "./menu-image-storage";

// ── DTO types (used by the controller validation classes) ──

export type CreateUpdateItemPayload = {
  name: string;
  description?: string;
  base_price_cents: number;
  category_id: string;
  stock_status: "NORMAL" | "LOW_STOCK" | "UNAVAILABLE";
  is_hidden: boolean;
  allowed_fulfillment_type: "BOTH" | "PICKUP" | "DELIVERY";
  modifier_groups?: Array<{ id: string }>;
  removable_ingredients?: Array<{ name: string; sortOrder: number }>;
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
  category: "MILD" | "MEDIUM" | "HOT" | "DRY_RUB";
  sort_order: number;
  is_active: boolean;
};

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

// ── Service ──

@Injectable()
export class AdminMenuService {
  private readonly imageStorage: MenuImageStorage;

  constructor(private readonly prisma: PrismaService) {
    this.imageStorage = new LocalMenuImageStorage();
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

    return this.prisma.menuCategory.create({
      data: {
        locationId,
        name: data.name,
        slug: finalSlug,
        sortOrder: data.sort_order,
        isActive: data.is_active,
        availableFromMinutes: availability.availableFromMinutes,
        availableUntilMinutes: availability.availableUntilMinutes,
      },
    });
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

    return this.prisma.menuCategory.update({
      where: { id },
      data: {
        name: data.name,
        sortOrder: data.sort_order,
        isActive: data.is_active,
        availableFromMinutes: availability.availableFromMinutes,
        availableUntilMinutes: availability.availableUntilMinutes,
        // slug stays stable on rename (v1)
      },
    });
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

    return this.prisma.menuCategory.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
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
        { sortOrder: "asc" }
      ],
    });
  }

  async createWingFlavour(locationId: string, data: CreateUpdateWingFlavourPayload) {
    if ((data as { category?: string }).category === "PLAIN") {
      throw new UnprocessableEntityException("Plain sauce is managed by the system");
    }
    const slug = generateSlug(data.name);
    const existing = await this.prisma.wingFlavour.findUnique({
      where: { locationId_slug: { locationId, slug } },
    });
    const finalSlug = existing ? `${slug}-${crypto.randomBytes(2).toString("hex")}` : slug;

    return this.prisma.wingFlavour.create({
      data: {
        locationId,
        name: data.name,
        slug: finalSlug,
        heatLevel: data.category,
        isPlain: false,
        isActive: data.is_active,
        sortOrder: data.sort_order,
      },
    });
  }

  async updateWingFlavour(locationId: string, id: string, data: CreateUpdateWingFlavourPayload) {
    const flavour = await this.prisma.wingFlavour.findFirst({
      where: { id, locationId, archivedAt: null },
    });
    if (!flavour) throw new NotFoundException("Sauce not found");
    if (flavour.heatLevel === "PLAIN") {
      throw new UnprocessableEntityException("Plain sauce is managed by the system");
    }

    return this.prisma.wingFlavour.update({
      where: { id },
      data: {
        name: data.name,
        heatLevel: data.category,
        isPlain: false,
        isActive: data.is_active,
        sortOrder: data.sort_order,
      },
    });
  }

  async archiveWingFlavour(locationId: string, id: string) {
    const flavour = await this.prisma.wingFlavour.findFirst({
      where: { id, locationId, archivedAt: null },
    });
    if (!flavour) throw new NotFoundException("Sauce not found");
    if (flavour.heatLevel === "PLAIN") {
      throw new UnprocessableEntityException("Plain sauce is managed by the system");
    }

    return this.prisma.wingFlavour.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false },
    });
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

    return this.prisma.$transaction(async (tx) => {
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

      return item;
    });
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

    return this.prisma.$transaction(async (tx) => {
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

      return tx.menuItem.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description ?? null,
          basePriceCents: data.base_price_cents,
          categoryId: data.category_id,
          stockStatus: data.stock_status,
          isHidden: data.is_hidden,
          isAvailable: data.stock_status !== "UNAVAILABLE",
          allowedFulfillmentType: data.allowed_fulfillment_type,
        },
      });
    });
  }

  async deleteItem(locationId: string, id: string) {
    return this.prisma.menuItem.updateMany({
      where: { id, locationId },
      data: { archivedAt: new Date() },
    });
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
      data: { imageUrl },
    });

    return { image_url: imageUrl };
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

    return { image_url: null };
  }

  // ────────── Validation helpers ──────────

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
}
