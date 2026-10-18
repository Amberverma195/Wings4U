import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { planBuilderSync } from '../prisma/builder-sync-plan.ts';
import { seedRestaurant } from '../prisma/seed-catalog.ts';

// Only pure routines and in-memory repositories. Never import a DB CLI wrapper.
const fixture = () => ({ catalog: [{ id: 'chicken', slug: 'chicken-burger', is_hidden: true, archived_at: 'fixture-date',
  removable_ingredients: [{ id: 'recipe', name: 'Lettuce' }], modifier_groups: [{ id: 'extras', name: 'Chicken Burger Extras',
    context_key: 'addon', min_select: 0, max_select: 2, is_required: false, selection_mode: 'MULTI', addon_scope_menu_item_id: 'chicken',
    options: [
      { id: 'removed', name: 'Extra Sriracha Mayo', price_delta_cents: 75, addon_match_normalized: 'sriracha mayo', is_active: false },
      { id: 'bacon', name: 'Add Bacon', price_delta_cents: 175, addon_match_normalized: '__always__', is_active: true },
      { id: 'lettuce', name: 'Extra Lettuce', price_delta_cents: 65, addon_match_normalized: '__always__', is_active: true },
    ] }] }] });

test('repeated builder plans cannot reactivate, recreate, relink or overwrite saved state', () => {
  const snapshot = fixture(), before = structuredClone(snapshot);
  const first = planBuilderSync(snapshot), second = planBuilderSync(snapshot);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(second, first);
  assert.equal(first.writes, 0);
  for (const kind of ['inactive_option', 'missing_option_unknown_if_removed', 'price_differs', 'authorization_differs', 'selection_limit_differs', 'archived_or_hidden_item'])
    assert.ok(first.differences.some(row => row.kind === kind), kind);
  assert.deepEqual(first.preserved_catalog, before.catalog);
  // Mutating a report cannot mutate menu data either.
  first.preserved_catalog[0].modifier_groups[0].options[0].is_active = true;
  assert.deepEqual(snapshot, before);
});

test('missing group links and physically absent options are unknown removals, never provisioning requests', () => {
  const snapshot = fixture(); snapshot.catalog[0].modifier_groups = [];
  const before = structuredClone(snapshot);
  const plan = planBuilderSync(snapshot);
  assert.ok(plan.differences.some(row => row.slug === 'chicken-burger' && row.kind === 'missing_group_or_link_unknown_if_removed'));
  assert.equal(plan.writes, 0); assert.deepEqual(snapshot, before);
  assert.ok(plan.differences.every(row => row.action === 'PRESERVE_ADMIN_CONFIGURATION'));
});

test('an existing location skips ALL seed writes, even when its menu is empty after cleanup', async () => {
  let reads = 0;
  const db = new Proxy({ location: { findUnique: async () => { reads++; return { id: 'existing', code: 'LON01' }; } } }, {
    get(target, key) { if (!(key in target)) throw new Error('Existing restaurant must not access ' + String(key)); return target[key]; },
  });
  await seedRestaurant(db); await seedRestaurant(db);
  assert.equal(reads, 2);
});

test('fresh disposable provisioning still creates the menu and subsequent seed calls do nothing', async () => {
  const saved = {}; let serial = 0, transactions = 0;
  const db = new Proxy({
    $transaction: async callback => { transactions++; return callback(db); },
  }, { get(target, model) {
    if (model in target) return target[model];
    return {
      findUnique: async () => saved[model]?.find(row => row.code === 'LON01') ?? null,
      create: async ({ data }) => { const row = { id: 'fixture-' + ++serial, ...data }; (saved[model] ??= []).push(row); return row; },
      createMany: async ({ data }) => { (saved[model] ??= []).push(...data); return { count: data.length }; },
      updateMany: async ({ where, data }) => { for (const row of saved[model] ?? []) if (row.name === where.name && where.modifierGroupId.in.includes(row.modifierGroupId)) Object.assign(row, data); return { count: 0 }; },
    };
  } });
  await seedRestaurant(db);
  assert.equal(transactions, 1);
  assert.ok(saved.menuItem.some(row => row.slug === 'chicken-burger'));
  assert.ok(saved.menuItem.some(row => row.slug === 'buffalo-chicken-burger'));
  assert.ok(saved.modifierOption.length > 0);
  assert.ok(!saved.modifierOption.some(row => /^(add|extra) (avocado|jalapenos)$/i.test(row.name)));
  const before = structuredClone(saved);
  await seedRestaurant(db); assert.deepEqual(saved, before); assert.equal(transactions, 1);
});

test('production guard refuses every hosted, remote, mixed and unconfigured target even with opt-in', () => {
  // Synthetic environment only: never read or change real connection variables.
  const source = fs.readFileSync(new URL('../production-database-guard.cjs', import.meta.url), 'utf8');
  for (const allow of [undefined, 'true']) {
    const context = { module: { exports: {} }, process: { env: { DATABASE_ALLOW_DESTRUCTIVE: allow } }, URL };
    vm.runInNewContext(source, context);
    const { requireSafeDestructiveTarget } = context.module.exports;
    for (const urls of [[], ['postgresql://u:p@db.fake.supabase.co/db'], ['postgresql://u:p@custom.example/db'],
      ['postgresql://u:p@localhost/db', 'postgresql://u:p@remote.railway.app/db'], ['not-a-url']])
      assert.throws(() => requireSafeDestructiveTarget('fixture import', urls));
    if (allow) assert.doesNotThrow(() => requireSafeDestructiveTarget('fixture init', ['postgresql://u:p@127.0.0.1/db']));
    else assert.throws(() => requireSafeDestructiveTarget('fixture init', ['postgresql://u:p@127.0.0.1/db']));
  }
});

test('database CLI boundaries enforce guard-before-client and builder review has no DB entry point', () => {
  for (const name of ['seed.ts', 'import-menu.ts', 'normalize-menu-legacy-sizes.ts']) {
    const source = fs.readFileSync(new URL('../prisma/' + name, import.meta.url), 'utf8');
    assert.ok(source.indexOf('requireSafeDestructiveTarget(') < source.indexOf('new PrismaClient('));
    assert.ok(source.includes('requireSafeDestructiveTarget('));
  }
  const sync = fs.readFileSync(new URL('../prisma/sync-builder-config.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(sync, /dotenv|PrismaClient|PrismaPg|DATABASE_URL|DIRECT_URL|\.update\(|\.create\(|\.deleteMany\(/);
});

test('historical modifier foreign keys require retention; carts and audit payloads keep their snapshots', () => {
  const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const modifiers = schema.split('model OrderItemModifier {')[1].split('\n}')[0];
  assert.match(modifiers, /modifierOption\s+ModifierOption\?\s+@relation\([^\n]*onDelete: NoAction/);
  assert.match(modifiers, /modifierGroup\s+ModifierGroup\?\s+@relation\([^\n]*onDelete: NoAction/);
  assert.match(modifiers, /modifierNameSnapshot/);
  const carts = schema.split('model SavedCartItem {')[1].split('\n}')[0];
  assert.match(carts, /modifierSelectionsJson\s+Json/);
  assert.match(schema.split('model AdminAuditLog {')[1].split('\n}')[0], /payloadJson\s+Json/);
});
