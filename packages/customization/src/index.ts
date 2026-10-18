/** Pure catalog rules, shared by customer clients and quote/checkout validation. */
export type Option = {
  id: string; name: string; price_delta_cents: number; is_default: boolean;
  addon_match_normalized?: string | null; linked_flavour_id?: string | null;
  sort_order?: number;
};
export type Group = {
  id: string; name: string; display_label: string; context_key: string | null;
  selection_mode: string; min_select: number; max_select: number | null;
  is_required: boolean; sort_order: number; options: Option[];
  /** Issued by the server only for a dedicated, singly linked item group. */
  addon_scope_menu_item_id?: string | null;
};
export type Product = {
  id: string; modifier_groups: Group[]; removable_ingredients: Array<{ id: string; name: string; sort_order?: number }>;
};
export type Selections = Record<string, readonly string[]>;
export type CatalogIssue = { kind: 'duplicate' | 'price_conflict' | 'id_conflict'; option_ids: string[]; group_ids: string[]; message: string };

/** Legacy schema has no scope column: recognize dedicated editor/seed groups
 * only when their complete relation set proves exclusive ownership. */
export function dedicatedAddonScope(groupName: string, linkedItemIds: string[], itemId: string): string | null {
  return linkedItemIds.length === 1 && linkedItemIds[0] === itemId ? itemId : null;
}

export function normalizeIngredientText(value: string = ''): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function inferOptionSizeScope(name: string, sizeNames: string[]): string | null {
  const words = ` ${normalizeIngredientText(name)} `;
  return [...sizeNames].sort((a, b) => b.length - a.length).find(size => words.includes(` ${size} `)) ?? null;
}

export function minimumSelections(group: Group): number {
  return Math.max(group.min_select, group.is_required ? 1 : 0);
}
export function maximumSelections(group: Group): number {
  return group.selection_mode === 'SINGLE' ? Math.min(1, group.max_select ?? 1) : group.max_select ?? Infinity;
}

export function customizationCatalog<T extends Group>(item: Product & { modifier_groups: T[] }, selections: Selections = {}): { groups: T[]; issues: CatalogIssue[] } {
  const ingredients = new Set(item.removable_ingredients.map(row => normalizeIngredientText(row.name)));
  const sizes = item.modifier_groups.filter(group => group.context_key === 'size');
  const sizeNames = sizes.flatMap(group => group.options.map(option => normalizeIngredientText(option.name)));
  const selectedSizes = sizes.flatMap(group => group.options.filter(option => selections[group.id]?.includes(option.id)).map(option => normalizeIngredientText(option.name)));
  const dedicated = item.modifier_groups.some(group => group.context_key === 'addon' && group.addon_scope_menu_item_id === item.id && / additional ingredients$/i.test(group.name));
  const groups = [...item.modifier_groups].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)).map(group => ({
    ...group,
    options: [...group.options].filter(option => {
      if (group.context_key !== 'addon') return true;
      if (dedicated && (group.addon_scope_menu_item_id !== item.id || !/ additional ingredients$/i.test(group.name))) return false;
      const match = option.addon_match_normalized;
      const authorized = match === '__always__' ? group.addon_scope_menu_item_id === item.id
        : Boolean(match && ingredients.has(normalizeIngredientText(match)));
      if (!authorized) return false;
      const size = inferOptionSizeScope(option.name, sizeNames);
      return !size || selectedSizes.includes(size);
    }).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name)),
  })) as T[];
  const issues: CatalogIssue[] = [];
  const seen = new Map<string, Array<{ group: T; option: Option }>>();
  const ids = new Map<string, { group: T; option: Option }>();
  const excluded = new Set<Option>();
  for (const group of groups) for (const option of group.options) {
    const priorId = ids.get(option.id);
    if (priorId) {
      issues.push({ kind: 'id_conflict', option_ids: [option.id], group_ids: [priorId.group.id, group.id], message: 'One option ID is mapped more than once. Please review this item.' });
      excluded.add(priorId.option); excluded.add(option);
    } else ids.set(option.id, { group, option });
    // Required groups and slots retain their distinct business meaning.
    if (group.context_key !== 'addon' || minimumSelections(group) > 0 || group.selection_mode !== 'MULTI') continue;
    const key = [normalizeIngredientText(option.name).replace(/^(add|extra) /, ''), option.addon_match_normalized ?? '', option.linked_flavour_id ?? ''].join('|');
    const rows = seen.get(key) ?? [];
    rows.push({ group, option }); seen.set(key, rows);
  }
  for (const rows of seen.values()) {
    if (rows.length < 2) continue;
    const conflict = new Set(rows.map(row => row.option.price_delta_cents)).size > 1;
    issues.push({ kind: conflict ? 'price_conflict' : 'duplicate', option_ids: rows.map(row => row.option.id), group_ids: rows.map(row => row.group.id),
      message: conflict ? 'Conflicting extra prices. Please review this item with the restaurant.' : 'Equivalent extras are linked through multiple groups.' });
    rows.slice(conflict ? 0 : 1).forEach(row => excluded.add(row.option));
  }
  // Keep required empty groups so they fail validation instead of becoming quick-add.
  return { groups: groups.map(group => ({ ...group, options: group.options.filter(option => !excluded.has(option)) })) as T[], issues };
}

export function defaultSelections(groups: Group[]): Record<string, string[]> {
  return Object.fromEntries(groups.map(group => [group.id, group.options.filter(option => option.is_default ||
    (group.context_key === 'size' && group.selection_mode === 'SINGLE' && group.options.length === 1)).slice(0, maximumSelections(group)).map(option => option.id)]));
}

export function initialCustomizationSelections(item: Product): Record<string, string[]> {
  return defaultSelections(customizationCatalog(item, defaultSelections(item.modifier_groups)).groups);
}

/** Accept both established kitchen-summary formats while preserving customer text. */
export function customerCustomizationInstructions(text: string, itemName: string, payload?: {
  builder_type: string; child_name?: string; removed_ingredients?: Array<{ name: string }>;
  child_addons?: Array<{ name: string }>;
}): string {
  const cleaned = text.split(/\n\n+/).filter(part => !part.trim().startsWith('Add-on: Small fries + pop')).join('\n\n').trim();
  if (payload?.builder_type !== 'LUNCH_SPECIAL') return cleaned;
  const removed = (payload.removed_ingredients ?? []).map(row => row.name).join(', ');
  const added = (payload.child_addons ?? []).map(row => row.name).join(', ');
  const parts = cleaned.split('|').map(part => part.trim()).filter(Boolean);
  const webFormat = parts[0] === `Lunch ${itemName}: ${payload.child_name}`;
  const mobileFormat = parts[0] === payload.child_name;
  if (!webFormat && !mobileFormat) return cleaned;
  parts.shift();
  if (removed && parts[0] === `${webFormat ? 'No:' : 'No'} ${removed}`) parts.shift();
  if (added && parts[0] === `${webFormat ? 'Add:' : 'Add'} ${added}`) parts.shift();
  return parts.join(' | ');
}

export function validateSelections(groups: Group[], selections: Selections): string | null {
  for (const [groupId, ids] of Object.entries(selections)) {
    if (ids.length && !groups.some(group => group.id === groupId)) return 'Menu options changed. Please review your selections.';
  }
  const seen = new Set<string>();
  for (const group of groups) {
    const selected = selections[group.id] ?? [];
    if (new Set(selected).size !== selected.length || selected.some(id => seen.has(id) || !group.options.some(option => option.id === id))) return 'Menu options changed. Please review your selections.';
    selected.forEach(id => seen.add(id));
    if (selected.length < minimumSelections(group)) return `Choose ${group.display_label || group.name}`;
    if (selected.length > maximumSelections(group)) return `Choose fewer options for ${group.display_label || group.name}`;
  }
  return null;
}

export function modifierTotal(groups: Group[], selections: Selections): number {
  return groups.reduce((total, group) => total + group.options.filter(option => selections[group.id]?.includes(option.id)).reduce((sum, option) => sum + option.price_delta_cents, 0), 0);
}

// Existing server contract stores the side/pop upgrade as labels, with one fixed charge.
export const SIDE_POP_BUNDLE_PRICE_CENTS = 499;
export const SIDE_POP_BUNDLE_SLUGS = new Set(['veggie-burger', 'chicken-burger', 'buffalo-chicken-burger', 'veggie-wrap', 'chicken-caesar-wrap', 'buffalo-chicken-wrap', 'garden-chicken-wrap', 'greek-chicken-wrap']);
export const SIDE_POP_SIDES = ['Fries', 'Onion rings', 'Wedges', 'Coleslaw'] as const;
export const SIDE_POP_DRINKS = ['Pepsi', 'Diet Pepsi', 'Pepsi Zero', 'Coke', 'Diet Coke', 'Coke Zero', 'Mountain Dew', 'Diet Mountain Dew'] as const;
