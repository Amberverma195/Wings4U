import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, WingFlavour } from '@prisma/client';
import { getLunchAddonOptionIds } from './pricing';
import {
  assertMenuItemOrderable, assertWingFlavoursOrderable, isMenuCategoryScheduledAt,
  isMenuItemScheduledAt, type ScheduleContext, type ValidationMenuItem,
} from './order-validation';

function reject(message: string): never {
  throw new UnprocessableEntityException({ message, field: 'items' });
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
}): Promise<void> {
  const { db, locationId, menuItem, builderPayload: payload, context } = params;
  const wings = menuItem.builderType === 'WINGS' || menuItem.builderType === 'WING_COMBO';
  const lunch = payload?.builder_type === 'LUNCH_SPECIAL';
  if (!wings && !lunch) return;

  const mappings = await db.menuItemModifierGroup.findMany({
    where: { menuItemId: menuItem.id }, orderBy: [{ sortOrder: 'asc' }, { modifierGroupId: 'asc' }],
    include: { modifierGroup: { include: { options: true } } },
  });
  const groups = mappings.map(row => ({ ...row.modifierGroup, contextKey: row.contextKey ?? row.modifierGroup.contextKey }));
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

  if (lunch) {
    // Established by both lunch builders: burgers for lunch-burger, wraps for lunch-wrap.
    const categorySlug = menuItem.slug === 'lunch-burger' ? 'burgers' : menuItem.slug === 'lunch-wrap' ? 'wraps' : null;
    if (!categorySlug || typeof payload.child_menu_item_id !== 'string' || !payload.child_menu_item_id.trim()) {
      reject('Invalid lunch child product');
    }
    const child = await db.menuItem.findFirst({
      where: { id: payload.child_menu_item_id as string, locationId },
      include: { category: true, schedules: true, removableIngredients: true,
        modifierGroups: { include: { modifierGroup: { include: { options: true } } } } },
    });
    if (!child || child.category.slug !== categorySlug || child.isHidden || child.stockStatus === 'UNAVAILABLE' ||
        /-side-add$/i.test(child.slug) || /side\s*&\s*pop/i.test(child.name)) reject('Invalid lunch child product');
    assertMenuItemOrderable({ menuItem: child, fulfillmentType: params.fulfillmentType, specialInstructions: params.specialInstructions });
    if (!isMenuCategoryScheduledAt(child.category, context) || !isMenuItemScheduledAt(child, context)) reject('Lunch child is unavailable at the selected time');
    const childGroups = child.modifierGroups.map(row => ({ ...row.modifierGroup, contextKey: row.contextKey ?? row.modifierGroup.contextKey }));
    if (childGroups.some(group => group.locationId !== locationId || group.archivedAt)) reject('Invalid lunch child catalogue configuration');
    checkSelections(getLunchAddonOptionIds(payload), childGroups.filter(group => group.contextKey === 'addon' || /extras/i.test(group.name)));
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
