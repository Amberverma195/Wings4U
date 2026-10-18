import { normalizeIngredientText } from '@wings4u/customization';
import { SCOPED_ADDON_SPECS } from './builder-defaults';

type SnapshotOption = {
  id: string; name: string; price_delta_cents: number; is_active?: boolean;
  addon_match_normalized?: string | null;
};
type SnapshotGroup = {
  id: string; name: string; context_key: string | null; options: SnapshotOption[];
  min_select?: number; max_select?: number | null; is_required?: boolean;
  selection_mode?: string; addon_scope_menu_item_id?: string | null;
};
export type MenuSnapshot = {
  catalog: Array<{
    id: string; slug: string; archived_at?: unknown; is_hidden?: boolean;
    modifier_groups?: SnapshotGroup[];
  }>;
};

/** Offline comparison, deliberately without a persistence client or apply mode.
 * Missing rows/links cannot distinguish owner removal from incomplete setup.
 * Every difference therefore preserves the saved configuration. */
export function planBuilderSync(snapshot: MenuSnapshot) {
  if (!snapshot || !Array.isArray(snapshot.catalog)) throw new Error('Expected a catalog snapshot, not database credentials');
  const differences: Array<{ slug: string; kind: string; group_id?: string; option_id?: string; name: string;
    saved?: unknown; default?: unknown; action: 'PRESERVE_ADMIN_CONFIGURATION' }> = [];
  const add = (slug: string, kind: string, name: string, detail: Partial<typeof differences[number]> = {}) =>
    differences.push({ slug, kind, name, ...detail, action: 'PRESERVE_ADMIN_CONFIGURATION' });
  for (const [slug, spec] of Object.entries(SCOPED_ADDON_SPECS)) {
    const item = snapshot.catalog.find(row => row.slug === slug);
    if (!item) { add(slug, 'missing_item_unknown_if_removed', slug); continue; }
    if (item.archived_at || item.is_hidden) add(slug, 'archived_or_hidden_item', slug);
    const groups = item.modifier_groups ?? [];
    const group = groups.find(row => row.name === spec.groupName && row.context_key === 'addon');
    if (!group) {
      add(slug, 'missing_group_or_link_unknown_if_removed', spec.groupName);
      continue;
    }
    const limits = { min_select: 0, max_select: spec.options.length, is_required: false, selection_mode: 'MULTI' };
    for (const [field, expected] of Object.entries(limits)) {
      const saved = group[field as keyof typeof limits];
      if (saved !== expected) add(slug, 'selection_limit_differs', field, { group_id: group.id, saved, default: expected });
    }
    for (const option of spec.options) {
      const saved = group.options.filter(row => row.name === option.name);
      if (!saved.length) { add(slug, 'missing_option_unknown_if_removed', option.name, { group_id: group.id }); continue; }
      for (const row of saved) {
        const detail = { group_id: group.id, option_id: row.id };
        if (row.is_active === false) add(slug, 'inactive_option', row.name, detail);
        if (row.price_delta_cents !== option.price) add(slug, 'price_differs', row.name, { ...detail, saved: row.price_delta_cents, default: option.price });
        const expected = 'scopeIngredientName' in option && option.scopeIngredientName
          ? normalizeIngredientText(option.scopeIngredientName) : '__always__';
        if (row.addon_match_normalized !== expected) add(slug, 'authorization_differs', row.name, { ...detail, saved: row.addon_match_normalized ?? null, default: expected });
      }
    }
  }
  return { mode: 'OFFLINE_REVIEW_ONLY', writes: 0, differences,
    policy: 'Existing data is authoritative. No additions, reactivations, relinks, removals or value changes are permitted.',
    // Include admin-only groups/options, scope, limits and hidden/archived items
    // as preserved state, even when no historical default exists to compare.
    preserved_catalog: structuredClone(snapshot.catalog) } as const;
}
