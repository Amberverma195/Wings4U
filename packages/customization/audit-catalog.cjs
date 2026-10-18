'use strict';
// Menu configuration only. PostgreSQL enforces read-only from connection startup.
const { Client } = require('pg');
const { config } = require('dotenv');
const fs = require('node:fs');
const path = require('node:path');
const { customizationCatalog, dedicatedAddonScope, normalizeIngredientText } = require('./dist');
const root = path.resolve(__dirname, '../..');
config({ path: path.join(root, '.env'), quiet: true });

async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    options: '-c default_transaction_read_only=on -c statement_timeout=15000', connectionTimeoutMillis: 10000 });
  if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) throw new Error('No existing catalog connection configured');
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const mode = await client.query('SHOW transaction_read_only');
    if (mode.rows[0].transaction_read_only !== 'on') throw new Error('Read-only enforcement unavailable');
    const items = (await client.query(`SELECT id, name, slug, description, base_price_cents, builder_type, archived_at, is_hidden FROM menu_items ORDER BY name, id`)).rows;
    const ingredients = (await client.query('SELECT id, menu_item_id, name, sort_order FROM removable_ingredients ORDER BY sort_order, id')).rows;
    const groups = (await client.query('SELECT id, name, display_label, selection_mode, min_select, max_select, is_required, sort_order, context_key, archived_at FROM modifier_groups')).rows;
    const options = (await client.query('SELECT id, modifier_group_id, name, price_delta_cents, is_default, is_active, sort_order, addon_match_normalized, linked_flavour_id FROM modifier_options ORDER BY sort_order, id')).rows;
    const mappings = (await client.query('SELECT menu_item_id, modifier_group_id, context_key, sort_order FROM menu_item_modifier_groups ORDER BY sort_order, modifier_group_id')).rows;
    await client.query('ROLLBACK');
    const findings = [];
    const snapshots = [];
    for (const item of items) {
      const linked = mappings.filter(row => row.menu_item_id === item.id).map(row => {
        const group = groups.find(group => group.id === row.modifier_group_id);
        return { ...group, context_key: row.context_key ?? group.context_key, sort_order: row.sort_order,
          addon_scope_menu_item_id: dedicatedAddonScope(group.name, mappings.filter(link => link.modifier_group_id === group.id).map(link => link.menu_item_id), item.id),
          options: options.filter(option => option.modifier_group_id === group.id && option.is_active) };
      });
      const product = { ...item, modifier_groups: linked, removable_ingredients: ingredients.filter(row => row.menu_item_id === item.id) };
      if (item.builder_type === 'WINGS' || item.builder_type === 'WING_COMBO') { snapshots.push({ ...item, modifier_group_count: linked.length, audit_scope: 'Dedicated wing builder excluded from ingredient audit' }); continue; }
      snapshots.push(product);
      const sizes = Object.fromEntries(linked.filter(group => group.context_key === 'size').map(group => [group.id, group.options.map(option => option.id)]));
      const result = customizationCatalog(product, sizes);
      const add = (kind, detail) => findings.push({ kind, menu_item_id: item.id, menu_item_name: item.name, slug: item.slug, ...detail });
      const rawChoices = new Map();
      for (const group of linked.filter(group => group.context_key === 'addon')) for (const option of group.options) {
        const key = [normalizeIngredientText(option.name).replace(/^(add|extra) /, ''), option.addon_match_normalized ?? '', option.linked_flavour_id ?? ''].join('|');
        const rows = rawChoices.get(key) ?? [];
        rows.push({ group_id: group.id, group_name: group.name, option_id: option.id, option_name: option.name, price_delta_cents: option.price_delta_cents });
        rawChoices.set(key, rows);
      }
      for (const rows of rawChoices.values()) if (rows.length > 1) add('raw_duplicate_mapping', {
        records: rows, pricing_conflict: new Set(rows.map(row => row.price_delta_cents)).size > 1,
        reason: 'Separate option records have equivalent labels, scope and meaning before eligibility filtering. These are not duplicate rows of the composite mapping primary key.',
        proposed_change: 'NOT EXECUTED: remove unstocked choices; otherwise owner chooses a canonical ID after price review. Preserve historical order snapshots.',
      });
      for (const issue of result.issues) add(issue.kind, issue);
      for (const group of linked.filter(group => group.context_key === 'addon')) {
        if (!group.addon_scope_menu_item_id) add('legacy_shared_or_unscoped_group', { group_id: group.id, group_name: group.name,
          related_item_ids: mappings.filter(link => link.modifier_group_id === group.id).map(link => link.menu_item_id) });
        for (const option of group.options) {
          const unstocked = /^(add |extra )?(avocado|jalapeno|jalapenos)$/.test(normalizeIngredientText(option.name));
          const authorized = result.groups.some(row => row.options.some(choice => choice.id === option.id));
          if (!authorized || unstocked) add(unstocked ? 'owner_confirmed_unstocked_addon' : 'unauthorized_or_overlapping_addon', {
            group_id: group.id, group_name: group.name, option_id: option.id, option_name: option.name,
            price_delta_cents: option.price_delta_cents, addon_match_normalized: option.addon_match_normalized,
            reason: unstocked ? 'Owner confirms standalone ingredient is not stocked; prepared poppers are excluded.' : 'No valid ingredient mapping/item scope, shadowed by dedicated configuration, or duplicate/conflicting mapping.',
            proposed_change: 'NOT EXECUTED: owner reviews and removes the item mapping or deactivates this option through admin; retain historical order records.',
            affected_item_ids: mappings.filter(link => link.modifier_group_id === group.id).map(link => link.menu_item_id),
            compatibility: 'Existing carts/reorders using this ID must show review. Do not substitute another ID or delete historical modifiers.',
          });
        }
      }
      for (const ingredient of product.removable_ingredients) {
        if (item.description && !normalizeIngredientText(item.description).includes(normalizeIngredientText(ingredient.name))) {
          add('recipe_description_review', { ingredient_id: ingredient.id, ingredient_name: ingredient.name, description: item.description,
            reason: 'Recipe label is absent verbatim from description; possible synonym or real mismatch. Owner review only.' });
        }
      }
      if (/tender/i.test(item.slug) && !linked.some(group => group.context_key === 'dip' || /dip/i.test(group.display_label))) add('missing_expected_dip_review', { reason: 'Tender has no obvious dip group. Verify business requirements; do not invent records.' });
      if (item.description && !product.removable_ingredients.length && /burger|wrap/i.test(item.slug) && !/-side-add$/.test(item.slug) && !['lunch-burger', 'lunch-wrap'].includes(item.slug)) add('missing_recipe_review', { description: item.description });
    }
    const out = path.join(root, 'Docs/audits/non-wing-catalog-readonly.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ inspected_at: new Date().toISOString(), database_mode: 'READ ONLY; rolled back', mutations_executed: false,
      counts: { items: items.length, groups: groups.length, options: options.length, mappings: mappings.length }, findings, catalog: snapshots }, null, 2) + '\n');
    console.log(JSON.stringify({ report: 'Docs/audits/non-wing-catalog-readonly.json', counts: { items: items.length, findings: findings.length }, kinds: Object.fromEntries([...new Set(findings.map(row => row.kind))].map(kind => [kind, findings.filter(row => row.kind === kind).length])) }));
  } finally { await client.end(); }
}
main().catch(error => { console.error('Read-only catalog inspection failed:', error.code ?? error.name); process.exitCode = 1; });
