import type { CartItem } from './types';

/** Show every saved choice without deriving prices or exposing internal option IDs. */
export function checkoutItemDetails(item: CartItem): string[] {
  const details: string[] = [];
  const payload = item.builder_payload;
  const placement = (value: string) => value === 'ON_SIDE' ? 'on the side' : value === 'MIXED' ? 'mixed' : 'on wings';
  if (payload?.builder_type === 'WINGS' || payload?.builder_type === 'WING_COMBO') {
    const partyCount = item.name.match(/^(75|100)\s+wings/i)?.[1];
    const size = partyCount ? `${partyCount} wings` : payload.weight_lb ? `${payload.weight_lb} lb` : '';
    const wingType = payload.wing_type === 'BONELESS' ? 'Boneless' : payload.wing_type === 'BONE_IN' ? 'Bone-in' : '';
    const preparation = payload.preparation === 'NON_BREADED' ? 'Non-breaded' : payload.preparation === 'BREADED' ? 'Breaded' : '';
    const description = [size, wingType, preparation].filter(Boolean).join(' · ');
    if (description) details.push(description);
    for (const slot of payload.flavour_slots ?? []) details.push(`${slot.flavour_name} (${placement(slot.placement)})`);
    if (payload.extra_flavour) details.push(`Extra: ${payload.extra_flavour.flavour_name} (${placement(payload.extra_flavour.placement)})`);
    if (payload.saucing_method) details.push(`Saucing: ${payload.saucing_method.replace(/_/g, ' ').toLowerCase()}`);
    if (payload.saucing_customer_note) details.push(payload.saucing_customer_note);
    const salad = payload.salad_customization;
    if (salad) {
      details.push(`Salad: ${salad.salad_name}`);
      details.push(...new Set((salad.removed_ingredients ?? []).map(row => `Salad: No ${row.name}`)));
      details.push(...(salad.modifier_selections ?? []).map(row => `Salad: ${row.name}`));
    }
  }
  if (payload?.builder_type === 'LUNCH_SPECIAL') {
    details.push(`Lunch selection: ${payload.child_name}`);
    details.push(...(payload.child_addons ?? []).map(row => row.name));
  }
  if (payload?.builder_type === 'ITEM_CUSTOMIZATION' && payload.side_pop_bundle) {
    details.push(`Combo: ${payload.side_pop_bundle.side_label} & ${payload.side_pop_bundle.pop_label}`);
  }
  // Suppress descriptions mirrored between builder and cart data, while keeping
  // repeated choices within a source (including ordered flavour/combo slots).
  const builderDetails = new Set(details);
  details.push(...item.modifier_selections.map(row => `${row.group_name ? `${row.group_name}: ` : ''}${row.option_name}`)
    .filter(detail => !builderDetails.has(detail)));
  const removals = [...(item.removed_ingredients ?? []), ...(payload && 'removed_ingredients' in payload ? payload.removed_ingredients ?? [] : [])];
  details.push(...new Set(removals.map(row => `No ${row.name}`)));
  if (item.special_instructions.trim()) details.push(`Instructions: ${item.special_instructions.trim()}`);
  return details;
}
