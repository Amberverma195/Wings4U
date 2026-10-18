import { customizationCatalog, dedicatedAddonScope, validateSelections } from "@wings4u/customization";
import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, WingFlavour } from '@prisma/client';
import { getLunchAddonOptionIds } from './pricing';
import { requireWingSkuWeightLb } from './wing-sku';
import {
  assertMenuItemOrderable, assertWingFlavoursOrderable, isMenuCategoryScheduledAt,
  isMenuItemScheduledAt, type ScheduleContext, type ValidationMenuItem,
} from './order-validation';

function reject(message: string): never {
  throw new UnprocessableEntityException({ message, field: 'items' });
}

const mappingInclude = { modifierGroup: { include: { options: true, menuItems: { select: { menuItemId: true } } } } } as const;
const childInclude = { category: true, schedules: true, removableIngredients: true,
  modifierGroups: { include: mappingInclude } } as const;
type BuilderMapping = Prisma.MenuItemModifierGroupGetPayload<{ include: typeof mappingInclude }>;
type LunchChild = Prisma.MenuItemGetPayload<{ include: typeof childInclude }>;
export type BuilderCatalogContext = {
  mappings: Map<string, BuilderMapping[]>;
  children: Map<string, LunchChild>;
};

// Fresh per request/transaction. Never share prices or availability across requests.
export async function loadBuilderCatalogContext(params: {
  db: Prisma.TransactionClient; locationId: string; menuItems: ValidationMenuItem[];
  builderPayloads: Array<Record<string, unknown> | undefined>;
}): Promise<BuilderCatalogContext> {
  const ids = params.menuItems.filter(item => item.modifierGroups.length > 0 || item.builderType === 'WINGS' || item.builderType === 'WING_COMBO' ||
    ['lunch-burger', 'lunch-wrap'].includes(item.slug ?? '')).map(item => item.id);
  const childIds = [...new Set(params.builderPayloads.flatMap(payload => payload?.builder_type === 'LUNCH_SPECIAL' &&
    typeof payload.child_menu_item_id === 'string' && payload.child_menu_item_id.trim() ? [payload.child_menu_item_id] : []))];
  const [rows, children] = await Promise.all([
    ids.length ? params.db.menuItemModifierGroup.findMany({
      where: { menuItemId: { in: ids }, menuItem: { locationId: params.locationId } },
      orderBy: [{ sortOrder: 'asc' }, { modifierGroupId: 'asc' }], include: mappingInclude,
    }) : [],
    childIds.length ? params.db.menuItem.findMany({
      where: { id: { in: childIds }, locationId: params.locationId }, include: childInclude,
    }) : [],
  ]);
  const mappings = new Map<string, BuilderMapping[]>(ids.map(id => [id, []]));
  for (const row of rows) mappings.get(row.menuItemId)?.push(row);
  return { mappings, children: new Map(children.map(child => [child.id, child])) };
}

// Use the same linked-flavour groups and mapping order as catalog.service.ts.
// Each submitted menu item is already the concrete SKU, not the client display variant.
export async function assertBuilderCatalogValid(params: {
  db: Prisma.TransactionClient;
  locationId: string;
  menuItem: ValidationMenuItem;
  builderPayload?: Record<string, unknown>;
  modifierOptionIds: string[];
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  context: ScheduleContext;
  specialInstructions?: string;
  wingFlavourMap: Map<string, WingFlavour>;
  catalogContext?: BuilderCatalogContext;
}): Promise<void> {
  const { db, locationId, menuItem, builderPayload: payload, context } = params;
  const wings = menuItem.builderType === 'WINGS' || menuItem.builderType === 'WING_COMBO';
  const lunch = payload?.builder_type === 'LUNCH_SPECIAL';
  if (!wings && !lunch && !menuItem.modifierGroups.length && !params.modifierOptionIds.length) return;

  const mappings = params.catalogContext ? params.catalogContext.mappings.get(menuItem.id) ?? [] : await db.menuItemModifierGroup.findMany({
    where: { menuItemId: menuItem.id }, orderBy: [{ sortOrder: 'asc' }, { modifierGroupId: 'asc' }],
    include: mappingInclude,
  });
  const groups = mappings.map(row => ({ ...row.modifierGroup, sortOrder: row.sortOrder ?? row.modifierGroup.sortOrder, contextKey: row.contextKey ?? row.modifierGroup.contextKey }));
  if (groups.some(group => group.locationId !== locationId || group.archivedAt)) reject('Invalid builder catalogue configuration');

  const checkSelections = (selectedIds: string[], targetGroups: typeof groups, skip = new Set<string>()) => {
    if (new Set(selectedIds).size !== selectedIds.length) reject('Duplicate modifier selection');
    for (const id of selectedIds) {
      if (!targetGroups.some(group => group.options.some(option => option.id === id && option.isActive))) {
        reject('Modifier does not belong to the selected product');
      }
    }
    for (const group of targetGroups) {
      const count = group.options.filter(option => selectedIds.includes(option.id)).length;
      const min = skip.has(group.id) ? 0 : Math.max(group.minSelect, group.isRequired ? 1 : 0);
      const max = group.selectionMode === 'SINGLE' ? Math.min(1, group.maxSelect ?? 1) : group.maxSelect;
      if (count < min || (max != null && count > max)) reject('Invalid selections for ' + group.displayLabel);
    }
  };

  const checkCustomization = (product: { id: string; removableIngredients?: Array<{ id: string; name: string }> }, target: typeof groups, ids: string[]) => {
    const serialized = target.map(group => ({
      id: group.id, name: group.name, display_label: group.displayLabel, context_key: group.contextKey,
      selection_mode: group.selectionMode, min_select: group.minSelect, max_select: group.maxSelect,
      is_required: group.isRequired, sort_order: group.sortOrder,
      addon_scope_menu_item_id: dedicatedAddonScope(group.name, (group.menuItems ?? []).map(row => row.menuItemId), product.id),
      options: group.options.filter(option => option.isActive).map(option => ({ id: option.id, name: option.name,
        price_delta_cents: option.priceDeltaCents, is_default: option.isDefault, sort_order: option.sortOrder,
        addon_match_normalized: option.addonMatchNormalized, linked_flavour_id: option.linkedFlavourId })),
    }));
    const selections = Object.fromEntries(serialized.map(group => [group.id, group.options.filter(option => ids.includes(option.id)).map(option => option.id)]));
    const catalog = customizationCatalog({ id: product.id, modifier_groups: serialized, removable_ingredients: product.removableIngredients ?? [] }, selections);
    if (ids.some(id => !catalog.groups.some(group => group.options.some(option => option.id === id)))) reject('Menu options changed or are unauthorized. Please review this item.');
    const error = validateSelections(catalog.groups, selections);
    if (error) reject(error);
  };

  if (!wings && !lunch) {
    checkSelections(params.modifierOptionIds, groups);
    checkCustomization(menuItem, groups, params.modifierOptionIds);
    return;
  }

  if (lunch) {
    // Established by both lunch builders: burgers for lunch-burger, wraps for lunch-wrap.
    const categorySlug = menuItem.slug === 'lunch-burger' ? 'burgers' : menuItem.slug === 'lunch-wrap' ? 'wraps' : null;
    if (!categorySlug || typeof payload.child_menu_item_id !== 'string' || !payload.child_menu_item_id.trim()) {
      reject('Invalid lunch child product');
    }
    const child = params.catalogContext ? params.catalogContext.children.get(payload.child_menu_item_id as string) : await db.menuItem.findFirst({
      where: { id: payload.child_menu_item_id as string, locationId },
      include: childInclude,
    });
    if (!child || child.category.slug !== categorySlug || child.isHidden || child.stockStatus === 'UNAVAILABLE' ||
        /-side-add$/i.test(child.slug) || /side\s*&\s*pop/i.test(child.name)) reject('Invalid lunch child product');
    assertMenuItemOrderable({ menuItem: child, fulfillmentType: params.fulfillmentType, specialInstructions: params.specialInstructions });
    if (!isMenuCategoryScheduledAt(child.category, context) || !isMenuItemScheduledAt(child, context)) reject('Lunch child is unavailable at the selected time');
    const childGroups = child.modifierGroups.map(row => ({ ...row.modifierGroup, sortOrder: row.sortOrder ?? row.modifierGroup.sortOrder, contextKey: row.contextKey ?? row.modifierGroup.contextKey }));
    if (childGroups.some(group => group.locationId !== locationId || group.archivedAt)) reject('Invalid lunch child catalogue configuration');
    checkCustomization(child, childGroups.filter(group => group.contextKey === 'addon'), getLunchAddonOptionIds(payload));
    checkSelections(getLunchAddonOptionIds(payload), childGroups);
    const removed = payload.removed_ingredients;
    if (removed !== undefined) {
      if (!Array.isArray(removed)) reject('Invalid ingredient removals');
      const seen = new Set<string>();
      for (const row of removed) {
        if (!row || typeof row !== 'object' || typeof row.id !== 'string' || seen.has(row.id) ||
            !child.removableIngredients.some(ingredient => ingredient.id === row.id && ingredient.name === row.name)) reject('Invalid lunch ingredient removal');
        seen.add(row.id);
      }
    }
    checkSelections(params.modifierOptionIds, groups);
    return;
  }

  if (!payload || payload.builder_type !== menuItem.builderType) reject('Required wing builder is missing');
  const expectedWeight = requireWingSkuWeightLb(menuItem);
  if (typeof payload.weight_lb !== 'number' || !Number.isFinite(payload.weight_lb) || payload.weight_lb !== expectedWeight) {
    reject('Wing weight must match the purchased SKU');
  }
  if (!['BONE_IN', 'BONELESS'].includes(payload.wing_type as string) ||
      !['BREADED', 'NON_BREADED'].includes(payload.preparation as string) ||
      (payload.wing_type === 'BONELESS' && payload.preparation === 'NON_BREADED')) reject('Invalid wing preparation');
  const flavourGroups = groups.filter(group => group.options.some(option => option.linkedFlavourId));
  const slots = payload.flavour_slots;
  if (!flavourGroups.length || !Array.isArray(slots) || slots.length !== flavourGroups.length) reject('Incorrect wing flavour count');
  assertWingFlavoursOrderable({ builderPayload: payload, wingFlavourMap: params.wingFlavourMap });
  const saucedSlots: number[] = [];
  slots.forEach((slot, index) => {
    if (!slot || typeof slot !== 'object' || slot.slot_no !== index + 1 ||
        !flavourGroups[index].options.some(option => option.isActive && option.linkedFlavourId === slot.wing_flavour_id)) reject('Invalid wing flavour slot');
    const flavour = params.wingFlavourMap.get(slot.wing_flavour_id);
    if (!flavour || !flavour.isActive || flavour.archivedAt) reject('Unavailable wing flavour');
    if (!flavour.isPlain && flavour.heatLevel !== 'PLAIN') saucedSlots.push(index + 1);
  });
  const count = saucedSlots.length;
  const party = ['party-75-wings', 'party-100-wings'].includes(menuItem.slug ?? '');
  const methods = count <= 1 ? ['ON_WINGS', 'ON_SIDE'] : slots.length === 3 || (party && slots.length === 5)
    ? ['SPLIT_EVENLY', 'ALL_MIXED', 'TELL_US_HOW'] : count === 2 ? ['HALF_HALF', 'SIDE']
      : ['TWO_MIXED_ONE_SIDE', 'SPLIT_EVENLY', 'ALL_MIXED'];
  const method = payload.saucing_method;
  if (count > 0 && !methods.includes(method as string)) reject('Invalid saucing method');
  if (count === 0 && method != null && !methods.includes(method as string)) reject('Invalid saucing method');
  if (method === 'TELL_US_HOW' && !(typeof payload.saucing_customer_note === 'string' && payload.saucing_customer_note.trim())) reject('Saucing instructions are required');
  const needsSide = (count === 2 && method === 'SIDE') || (count >= 3 && method === 'TWO_MIXED_ONE_SIDE');
  if (needsSide && !saucedSlots.includes(payload.side_flavour_slot_no as number)) reject('Invalid side flavour slot');
  if (!needsSide && payload.side_flavour_slot_no != null) reject('Unexpected side flavour slot');
  slots.forEach((slot, index) => {
    let placement = 'ON_WINGS';
    if (saucedSlots.includes(index + 1)) {
      if (count === 1) placement = method === 'ON_SIDE' ? 'ON_SIDE' : 'ON_WINGS';
      else if (count === 2) placement = method === 'SIDE' && payload.side_flavour_slot_no === index + 1 ? 'ON_SIDE' : 'ON_WINGS';
      else if (method === 'ALL_MIXED') placement = 'MIXED';
      else if (method === 'TWO_MIXED_ONE_SIDE') placement = payload.side_flavour_slot_no === index + 1 ? 'ON_SIDE' : 'MIXED';
    }
    if (slot.placement !== placement) reject('Invalid sauce placement');
  });
  if (payload.extra_flavour !== undefined) {
    const extra = payload.extra_flavour as { wing_flavour_id?: string; placement?: string } | null;
    const flavour = extra && params.wingFlavourMap.get(extra.wing_flavour_id ?? '');
    if (!flavour || !flavour.isActive || flavour.archivedAt || flavour.isPlain || flavour.heatLevel === 'PLAIN' ||
        !['ON_WINGS', 'ON_SIDE'].includes(extra!.placement ?? '')) reject('Invalid extra flavour');
  }
  // Flavours live in the builder; preparation also has a catalogue modifier.
  const represented = new Set(flavourGroups.map(group => group.id));
  for (const group of groups) {
    if (group.contextKey === 'size') represented.add(group.id);
    if (/wing type/i.test(group.name) || /wing type/i.test(group.displayLabel)) {
      const selected = group.options.filter(option => params.modifierOptionIds.includes(option.id));
      for (const option of selected) {
        // Same established catalogue labels used by resolveWingTypeModifier in both clients.
        const label = option.name.toLowerCase();
        const matches = payload.wing_type === 'BONELESS' ? label.includes('boneless') :
          label.includes('breaded') && label.includes('bone') && !label.includes('boneless') &&
          label.includes('non') === (payload.preparation === 'NON_BREADED');
        if (!matches) reject('Wing preparation does not match its catalogue modifier');
      }
    }
  }
  const salad = payload.salad_customization as { salad_menu_item_id?: unknown; modifier_selections?: unknown } | undefined;
  if (salad !== undefined && (!salad || typeof salad !== 'object' || Array.isArray(salad) ||
      typeof salad.salad_menu_item_id !== 'string' || !salad.salad_menu_item_id.trim() ||
      (salad.modifier_selections !== undefined && (!Array.isArray(salad.modifier_selections) ||
        salad.modifier_selections.some(row => !row || typeof row.modifier_option_id !== 'string'))))) reject('Invalid salad customization');
  const saladIds = new Set(
    ((payload.salad_customization as { modifier_selections?: Array<{ modifier_option_id: string }> } | undefined)?.modifier_selections ?? []).map(row => row.modifier_option_id),
  );
  if (salad && params.catalogContext) {
    const saladGroups = (params.catalogContext.mappings.get(salad.salad_menu_item_id as string) ?? [])
      .map(row => ({ ...row.modifierGroup, sortOrder: row.sortOrder ?? row.modifierGroup.sortOrder, contextKey: row.contextKey ?? row.modifierGroup.contextKey }));
    if (saladGroups.some(group => group.locationId !== locationId || group.archivedAt)) reject('Invalid salad catalogue configuration');
    // The Special includes a small salad; both customer builders submit only its
    // add-ons. A standalone salad's required size is represented by the parent.
    const includedSize = new Set(menuItem.slug === 'wings-4u-special'
      ? saladGroups.filter(group => group.contextKey === 'size').map(group => group.id) : []);
    checkSelections([...saladIds], saladGroups, includedSize);
  }
  checkSelections(params.modifierOptionIds.filter(id => !saladIds.has(id)), groups, represented);
  if (menuItem.builderType === 'WING_COMBO') {
    for (const [key, field] of [['side', 'side_selections'], ['drink', 'drink_selections']] as const) {
      const target = groups.filter(group => group.contextKey === key);
      const choices = payload[field];
      if (!target.length || !Array.isArray(choices) || choices.length !== target.length ||
          target.some((group, index) => !group.options.some(option => option.id === choices[index] && option.isActive) || !params.modifierOptionIds.includes(choices[index]))) reject('Invalid combo ' + key + ' selections');
    }
  }
}
