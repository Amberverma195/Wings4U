import type { ReorderResponse, ReorderSkipReason } from '@wings4u/contracts';
import { getApiErrorMessage } from './api';
import type { CartBuilderPayload, CartItem } from './types';

export type MobileReorderPreview = ReorderResponse<CartBuilderPayload>;
export const REORDER_SKIP_COPY: Record<ReorderSkipReason, string> = {
  unavailable: 'currently unavailable', archived: 'no longer offered',
  location_mismatch: "not on this location's menu",
  required_group_missing: 'requires options that are no longer available',
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === 'string';
const money = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const removals = (value: unknown) => Array.isArray(value) && value.every(row => object(row) && text(row.id) && text(row.name));
const options = (value: unknown) => Array.isArray(value) && value.every(row => object(row) && text(row.modifier_option_id) && text(row.name) && Number.isSafeInteger(row.price_delta_cents));
function builder(value: unknown): boolean {
  if (value === null) return true;
  if (!object(value)) return false;
  if (value.builder_type === 'ITEM_CUSTOMIZATION') return removals(value.removed_ingredients) &&
    (value.side_pop_bundle === undefined || (object(value.side_pop_bundle) && value.side_pop_bundle.price_cents === 499 && text(value.side_pop_bundle.side_label) && text(value.side_pop_bundle.pop_label)));
  if (value.builder_type === 'LUNCH_SPECIAL') return text(value.child_menu_item_id) && text(value.child_name) && text(value.child_slug) && removals(value.removed_ingredients) && options(value.child_addons);
  if (value.builder_type !== 'WINGS' && value.builder_type !== 'WING_COMBO') return false;
  return ['BONE_IN', 'BONELESS'].includes(String(value.wing_type)) && ['BREADED', 'NON_BREADED'].includes(String(value.preparation)) &&
    typeof value.weight_lb === 'number' && Number.isFinite(value.weight_lb) && value.weight_lb > 0 &&
    Array.isArray(value.flavour_slots) && value.flavour_slots.length > 0 && value.flavour_slots.every(row => object(row) && Number.isSafeInteger(row.slot_no) && text(row.wing_flavour_id) && text(row.flavour_name) && ['ON_WINGS', 'ON_SIDE', 'MIXED'].includes(String(row.placement))) &&
    (value.extra_flavour === undefined || (object(value.extra_flavour) && text(value.extra_flavour.wing_flavour_id) && text(value.extra_flavour.flavour_name) && ['ON_WINGS', 'ON_SIDE', 'MIXED'].includes(String(value.extra_flavour.placement)))) &&
    (value.side_selections === undefined || (Array.isArray(value.side_selections) && value.side_selections.every(text))) &&
    (value.drink_selections === undefined || (Array.isArray(value.drink_selections) && value.drink_selections.every(text))) &&
    (value.salad_customization === undefined || (object(value.salad_customization) && text(value.salad_customization.salad_menu_item_id) && text(value.salad_customization.salad_name) && text(value.salad_customization.salad_slug) && removals(value.salad_customization.removed_ingredients) && options(value.salad_customization.modifier_selections)));
}

/** Reject malformed previews as a whole before any cart mutation. Prices remain server-owned. */
export function parseReorderPreview(value: unknown, orderId: string, locationId: string): MobileReorderPreview {
  const invalid = () => { throw new Error('The reorder could not be reviewed safely. Please try again.'); };
  if (!object(value) || value.order_id !== orderId || value.location_id !== locationId ||
    !['PICKUP', 'DELIVERY'].includes(String(value.fulfillment_type_hint)) || !Array.isArray(value.items) || !object(value.diff)) return invalid();
  if (value.all_unavailable !== (value.items.length === 0)) return invalid();
  for (const item of value.items) {
    if (!object(item) || !text(item.menu_item_id) || !text(item.name) || !money(item.base_price_cents) ||
      !Number.isSafeInteger(item.quantity) || (item.quantity as number) < 1 || !text(item.special_instructions) ||
      !(item.menu_item_slug === null || text(item.menu_item_slug)) || !(item.image_url === null || text(item.image_url)) ||
      !removals(item.removed_ingredients) || !builder(item.builder_payload) || !Array.isArray(item.modifier_selections) ||
      !item.modifier_selections.every(row => object(row) && text(row.modifier_option_id) && text(row.group_name) && text(row.option_name) && Number.isSafeInteger(row.price_delta_cents))) return invalid();
  }
  const diff = value.diff;
  if (!Array.isArray(diff.skipped) || !diff.skipped.every(row => object(row) && text(row.name) && Object.hasOwn(REORDER_SKIP_COPY, String(row.reason)) && (row.detail === undefined || text(row.detail))) ||
    !Array.isArray(diff.modifier_changes) || !diff.modifier_changes.every(row => object(row) && text(row.name) && Array.isArray(row.dropped) && row.dropped.every(text)) ||
    !Array.isArray(diff.price_changes) || !diff.price_changes.every(row => object(row) && text(row.name) && money(row.old_cents) && money(row.new_cents)) ||
    (diff.configuration_changes !== undefined && (!Array.isArray(diff.configuration_changes) || !diff.configuration_changes.every(row => object(row) && text(row.name) && Array.isArray(row.changes) && row.changes.every(text))))) return invalid();
  return value as MobileReorderPreview;
}

export function reorderCartItems(preview: MobileReorderPreview): Array<Omit<CartItem, 'key'>> {
  return preview.items.map(item => ({ menu_item_id: item.menu_item_id, menu_item_slug: item.menu_item_slug,
    name: item.name, image_url: item.image_url, base_price_cents: item.base_price_cents, quantity: item.quantity,
    modifier_selections: item.modifier_selections, removed_ingredients: item.removed_ingredients,
    special_instructions: item.special_instructions, builder_payload: item.builder_payload ?? undefined }));
}

export function reorderError(body: unknown, status: number): string {
  if (status === 401) return 'Please sign in again to reorder.';
  if (status === 403) return 'This order is not available for your account or location.';
  return getApiErrorMessage(body, 'Unable to review this reorder. Please try again.');
}
