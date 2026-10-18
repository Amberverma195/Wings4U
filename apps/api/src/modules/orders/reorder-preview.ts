import { ForbiddenException, HttpException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ReorderResponse } from '../../../../../packages/contracts/src/reorder-contract';
import type { PrismaService } from '../../database/prisma.service';
import type { CartService } from '../cart/cart.service';
import { rebuildReorderBuilder } from './reorder-builder';
import { SIDE_POP_BUNDLE_PRICE_CENTS } from '../shared/pricing';

export type ReorderContext = { fulfillment_type?: 'PICKUP' | 'DELIVERY'; scheduled_for?: string };
const terminal = new Set(['PICKED_UP', 'DELIVERED', 'NO_SHOW_PICKUP', 'NO_SHOW_DELIVERY', 'NO_PIN_DELIVERY', 'CANCELLED']);

/** Reads only. Uses the very same item validation and prices as Cart Quote. */
export async function previewReorder(db: PrismaService, cart: CartService, orderId: string, userId: string,
  context: ReorderContext = {}, scopedLocationId?: string): Promise<ReorderResponse> {
  const order = await db.order.findUnique({ where: { id: orderId }, include: {
    orderItems: { include: { modifiers: true, flavours: true }, orderBy: { lineNo: 'asc' } },
  } });
  if (!order) throw new NotFoundException('Order not found');
  if (order.customerUserId !== userId) throw new ForbiddenException('You do not have access to this order');
  if (scopedLocationId && scopedLocationId !== order.locationId) throw new ForbiddenException('This order belongs to a different location');
  if (!terminal.has(order.status)) throw new UnprocessableEntityException('Only past orders can be reordered');
  const currentItems = await db.menuItem.findMany({ where: {
    id: { in: order.orderItems.flatMap(item => item.menuItemId ? [item.menuItemId] : []) }, locationId: order.locationId,
  }, include: { modifierGroups: { include: { modifierGroup: true } }, removableIngredients: true } });
  const options = await db.modifierOption.findMany({ where: { id: { in: order.orderItems.flatMap(item =>
    item.modifiers.flatMap(mod => mod.modifierOptionId ? [mod.modifierOptionId] : [])) } }, include: { modifierGroup: true } });
  const optionMap = new Map(options.map(option => [option.id, option]));
  const response: ReorderResponse = { order_id: order.id, location_id: order.locationId,
    fulfillment_type_hint: order.fulfillmentType, items: [], all_unavailable: true,
    diff: { skipped: [], modifier_changes: [], price_changes: [], configuration_changes: [] } };
  for (const source of order.orderItems) {
    const name = source.productNameSnapshot;
    const current = currentItems.find(item => item.id === source.menuItemId);
    if (!current || current.archivedAt || !current.isAvailable || current.stockStatus === 'UNAVAILABLE') {
      response.diff.skipped.push({ name, reason: !source.menuItemId || current?.archivedAt ? 'archived' : !current ? 'location_mismatch' : 'unavailable' });
      continue;
    }
    try {
      const dropped: string[] = [], changes: string[] = [];
      const stored = source.builderPayloadJson as Record<string, unknown> | null;
      const salad = stored?.salad_customization as Record<string, unknown> | undefined;
      const nestedRemovals = stored?.builder_type === 'LUNCH_SPECIAL' ? stored.removed_ingredients : salad?.removed_ingredients;
      const nestedNames = new Set(Array.isArray(nestedRemovals) ? nestedRemovals.map(row =>
        row && typeof row === 'object' && typeof row.name === 'string' ? row.name.toLowerCase() : '') : []);
      const removalNames = source.modifiers.filter(mod => mod.modifierKind === 'REMOVE_INGREDIENT').map(mod => mod.modifierNameSnapshot);
      if (stored?.builder_type === 'ITEM_CUSTOMIZATION' && Array.isArray(stored.removed_ingredients)) {
        for (const row of stored.removed_ingredients) {
          if (row && typeof row === 'object' && typeof row.name === 'string') removalNames.push(row.name);
        }
      }
      const removed = [...new Set(removalNames.map(name => name.toLowerCase()))].flatMap(name => {
        const ingredient = current.removableIngredients.find(candidate => candidate.name.toLowerCase() === name);
        if (!ingredient) {
          if (!nestedNames.has(name)) dropped.push(`No ${removalNames.find(original => original.toLowerCase() === name)} (removal no longer offered)`);
          return [];
        }
        return [{ id: ingredient.id, name: ingredient.name }];
      });
      const payload = rebuildReorderBuilder(source.builderPayloadJson, removed);
      const selections = source.modifiers.filter(mod => mod.modifierKind !== 'REMOVE_INGREDIENT').flatMap(mod => {
        const option = mod.modifierOptionId ? optionMap.get(mod.modifierOptionId) : undefined;
        // Salad options are attached to their salad child, not to the parent wings SKU.
        const saladIds = (payload?.salad_customization as { modifier_selections?: Array<{ modifier_option_id: string }> } | undefined)?.modifier_selections ?? [];
        if (!option || !option.isActive || option.modifierGroup.archivedAt || option.modifierGroup.locationId !== order.locationId ||
          (!current.modifierGroups.some(group => group.modifierGroupId === option.modifierGroupId) && !saladIds.some(row => row.modifier_option_id === option.id))) {
          dropped.push(mod.modifierNameSnapshot); return [];
        }
        if (option.name !== mod.modifierNameSnapshot) changes.push(`${mod.modifierNameSnapshot} → ${option.name}`);
        return [{ modifier_option_id: option.id, group_name: option.modifierGroup.name, option_name: option.name, price_delta_cents: option.priceDeltaCents }];
      });
      // Dropping a builder-linked choice can alter preparation, flavour or paid configuration.
      // Require reconfiguration instead of silently choosing replacements.
      if (payload && payload.builder_type !== 'ITEM_CUSTOMIZATION' && dropped.length) {
        throw new UnprocessableEntityException('Some configuration options are no longer available. Please configure this item again from the menu.');
      }
      const incoming = { menu_item_id: current.id, quantity: source.quantity, modifier_selections: selections,
        removed_ingredients: removed, special_instructions: source.specialInstructions ?? '', builder_payload: payload };
      const validated = await cart.validateItems(order.locationId, context.fulfillment_type ?? order.fulfillmentType, [incoming], context.scheduled_for);
      // Hydrate all display metadata and embedded prices from the validated current catalogue.
      const refreshRows = (rows: unknown) => (rows as Array<Record<string, unknown>>).map(row => {
        const option = validated.optionMap.get(row.modifier_option_id as string)!;
        if (row.name !== option.name) changes.push(`${String(row.name ?? 'Option')} → ${option.name}`);
        return { modifier_option_id: option.id, name: option.name, price_delta_cents: option.priceDeltaCents };
      });
      if (payload?.builder_type === 'LUNCH_SPECIAL') {
        const child = validated.catalogContext.children.get(payload.child_menu_item_id as string)!;
        payload.child_name = child.name; payload.child_slug = child.slug;
        payload.child_addons = refreshRows(payload.child_addons);
      }
      if (payload?.builder_type === 'ITEM_CUSTOMIZATION' && payload.side_pop_bundle) {
        (payload.side_pop_bundle as Record<string, unknown>).price_cents = SIDE_POP_BUNDLE_PRICE_CENTS;
      }
      if (payload?.builder_type === 'WINGS' || payload?.builder_type === 'WING_COMBO') {
        const refreshFlavour = (row: Record<string, unknown>) => {
          const flavour = validated.wingFlavourMap.get(row.wing_flavour_id as string)!;
          if (row.flavour_name !== flavour.name) changes.push(`${String(row.flavour_name ?? 'Flavour')} → ${flavour.name}`);
          return { ...row, flavour_name: flavour.name };
        };
        payload.flavour_slots = (payload.flavour_slots as Array<Record<string, unknown>>).map(refreshFlavour);
        if (payload.extra_flavour) payload.extra_flavour = refreshFlavour(payload.extra_flavour as Record<string, unknown>);
        if (payload.salad_customization) {
          const salad = payload.salad_customization as Record<string, unknown>;
          const child = validated.menuItemMap.get(salad.salad_menu_item_id as string)!;
          salad.salad_name = child.name; salad.salad_slug = child.slug;
          salad.modifier_selections = refreshRows(salad.modifier_selections);
          salad.removed_ingredients = (salad.removed_ingredients as Array<{ id: string; name: string }>).map(row => {
            const ingredient = child.removableIngredients.find(ingredient => ingredient.id === row.id)!;
            if (row.name !== ingredient.name) changes.push(`No ${row.name} → No ${ingredient.name}`);
            return { id: ingredient.id, name: ingredient.name };
          });
        }
      }
      const unitPrice = validated.lineDetails[0].unit_price_cents;
      if (unitPrice !== source.unitPriceCents) response.diff.price_changes.push({ name, old_cents: source.unitPriceCents, new_cents: unitPrice });
      if (dropped.length) response.diff.modifier_changes.push({ name, dropped });
      if (changes.length) response.diff.configuration_changes!.push({ name, changes });
      response.items.push({ ...incoming, menu_item_slug: current.slug, name: current.name, image_url: current.imageUrl,
        base_price_cents: current.basePriceCents, builder_payload: payload ?? null });
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() !== 422) throw error;
      const body = error.getResponse();
      const detail = typeof body === 'string' ? body : (body as { reason?: string; message?: string }).reason ?? (body as { message?: string }).message;
      const code = typeof body === 'object' ? (body as { code?: string; field?: string }) : {};
      const unavailable = code.code === 'CART_ITEM_UNAVAILABLE' || code.code === 'SCHEDULE_VIOLATION' || code.code === 'LUNCH_SPECIAL_SCHEDULE_CONFLICT' || code.field === 'scheduled_for' || code.field === 'fulfillment_type';
      response.diff.skipped.push({ name, reason: unavailable ? 'unavailable' : 'required_group_missing', detail: detail ?? 'Please configure this item again from the menu.' });
    }
  }
  response.all_unavailable = response.items.length === 0;
  return response;
}
