import { UnprocessableEntityException } from '@nestjs/common';

type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UnprocessableEntityException('This configuration needs to be selected again.');
  return value as Row;
}
function pick(value: unknown, keys: string[]): Row {
  const source = row(value);
  checkKeys(source, keys);
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}
function checkKeys(source: Row, keys: string[]) {
  // Historical display prices may be discarded because pricing is recalculated.
  // An unknown choice might represent a paid option: require reconfiguration.
  if (Object.keys(source).some(key => !keys.includes(key) && !['price_cents', 'price_delta_cents'].includes(key))) {
    throw new UnprocessableEntityException('This configuration contains unsupported options. Please configure this item again from the menu.');
  }
}
function list(value: unknown, keys: string[]): Row[] {
  if (!Array.isArray(value)) throw new UnprocessableEntityException('This configuration needs to be selected again.');
  return value.map(entry => pick(entry, keys));
}

/** Rebuild only supported configuration fields. Never propagate arbitrary historical JSON. */
export function rebuildReorderBuilder(value: unknown, removals: Array<{ id: string; name: string }>): Row | undefined {
  if (value == null) return undefined;
  const source = row(value);
  if (source.builder_type === 'ITEM_CUSTOMIZATION') {
    checkKeys(source, ['builder_type', 'removed_ingredients', 'side_pop_bundle']);
    if (list(source.removed_ingredients ?? [], ['id', 'name']).some(ingredient => typeof ingredient.id !== 'string' || typeof ingredient.name !== 'string')) {
      throw new UnprocessableEntityException('Ingredient removals need to be selected again.');
    }
    return { builder_type: source.builder_type, removed_ingredients: removals,
      ...(source.side_pop_bundle !== undefined ? { side_pop_bundle: pick(source.side_pop_bundle, ['side_label', 'pop_label']) } : {}) };
  }
  if (source.builder_type === 'LUNCH_SPECIAL') {
    checkKeys(source, ['builder_type', 'child_menu_item_id', 'child_name', 'child_slug', 'removed_ingredients', 'child_addons']);
    return { builder_type: source.builder_type, child_menu_item_id: source.child_menu_item_id, child_name: source.child_name, child_slug: source.child_slug,
      removed_ingredients: list(source.removed_ingredients ?? [], ['id', 'name']),
      child_addons: list(source.child_addons ?? [], ['modifier_option_id', 'name']) };
  }
  if (source.builder_type === 'WINGS' || source.builder_type === 'WING_COMBO') {
    const fields = ['builder_type', 'wing_type', 'preparation', 'weight_lb', 'saucing_method',
      'saucing_customer_note', 'side_flavour_slot_no', 'side_selections', 'drink_selections'];
    checkKeys(source, [...fields, 'flavour_slots', 'extra_flavour', 'salad_customization']);
    const base = Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
    if (source.salad_customization !== undefined) checkKeys(row(source.salad_customization),
      ['salad_menu_item_id', 'salad_name', 'salad_slug', 'removed_ingredients', 'modifier_selections']);
    const salad = source.salad_customization === undefined ? undefined : row(source.salad_customization);
    return { ...base,
      flavour_slots: list(source.flavour_slots, ['slot_no', 'wing_flavour_id', 'flavour_name', 'placement']),
      ...(source.extra_flavour !== undefined ? { extra_flavour: pick(source.extra_flavour, ['wing_flavour_id', 'flavour_name', 'placement']) } : {}),
      ...(source.salad_customization !== undefined ? { salad_customization: {
        salad_menu_item_id: salad!.salad_menu_item_id, salad_name: salad!.salad_name, salad_slug: salad!.salad_slug,
        removed_ingredients: list(row(source.salad_customization).removed_ingredients ?? [], ['id', 'name']),
        modifier_selections: list(row(source.salad_customization).modifier_selections ?? [], ['modifier_option_id', 'name']),
      } } : {}) };
  }
  throw new UnprocessableEntityException('This configuration is no longer supported. Please configure it again from the menu.');
}
