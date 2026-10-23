jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
import { DbCartStore } from './db-cart-store';
import { Prisma } from '@prisma/client';
import { SavedCartService } from './saved-cart.service';
import { setGuestTokenCookie } from './guest-cart-cookie';
import { CUSTOMER_CART_TTL_MS, GUEST_CART_TTL_MS, type CartIdentity } from './saved-cart.types';

const now = Date.parse('2026-10-23T16:00:00Z');
const guest: CartIdentity = { kind: 'guest', guestToken: 'a'.repeat(64) };
const user: CartIdentity = { kind: 'user', userId: 'customer' };
const input = { items: [{ key: 'line', menu_item_id: 'wings', menu_item_slug: null, name: 'Wings', image_url: null,
  base_price_cents: 1000, quantity: 2, modifier_selections: [], removed_ingredients: [], special_instructions: '', builder_payload: null }],
  fulfillment_type: 'DELIVERY' as const, location_timezone: 'America/Toronto', scheduled_for: null, driver_tip_percent: 'none' as const };

function fixture(identity = user, options: { expiry?: Date | null; updatedAt?: Date | null } = {}) {
  let rows: any[] = [];
  const itemRow = (item: any) => ({ ...item, builderPayloadJson: item.builderPayloadJson === Prisma.JsonNull ? null : item.builderPayloadJson });
  const clone = (row: any) => row ? { ...row, items: row.items.map((item: any) => ({ ...item })) } : null;
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object' && 'not' in value ? row[key] !== value.not : row[key] === value);
  const tx: any = {
    $queryRaw: jest.fn(async () => []),
    savedCart: {
      findFirst: jest.fn(async ({ where }: any) => clone(rows.find(row => matches(row, where)))),
      create: jest.fn(async ({ data }: any) => {
        if (rows.some(row => row.status === data.status && row.locationId === data.locationId &&
          (data.userId ? row.userId === data.userId : row.guestToken === data.guestToken))) throw new Error('Unique ACTIVE constraint');
        const row = { id: String(rows.length + 1), userId: null, guestToken: null, updatedAt: new Date(), ...data, items: (data.items?.create ?? []).map(itemRow) };
        rows.push(row); return clone(row);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find(row => matches(row, where)); Object.assign(row, data, { updatedAt: new Date() }); return clone(row);
      }),
      deleteMany: jest.fn(async ({ where }: any) => { rows = rows.filter(row => !matches(row, where)); }),
    },
    savedCartItem: {
      deleteMany: jest.fn(async ({ where }: any) => { rows.find(row => row.id === where.cartId).items = []; }),
      createMany: jest.fn(async ({ data }: any) => { for (const item of data) rows.find(row => row.id === item.cartId).items.push(itemRow(item)); }),
    },
  };
  let queue = Promise.resolve();
  const prisma = { ...tx, $transaction: (callback: any) => {
    const operation = queue.then(() => callback(tx)); queue = operation.catch(() => {}); return operation;
  } };
  const store = new DbCartStore(prisma as never);
  const seed = async () => {
    await store.saveSnapshot(identity, 'store', input);
    if ('expiry' in options) rows[0].expiresAt = options.expiry;
    if ('updatedAt' in options) rows[0].updatedAt = options.updatedAt;
    jest.clearAllMocks();
  };
  return { store, tx, seed, rows: () => rows };
}

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
afterEach(() => jest.useRealTimers());

it.each([[guest, GUEST_CART_TTL_MS], [user, CUSTOMER_CART_TTL_MS]] as const)('enforces inactivity boundary for %j', async (identity, ttl) => {
  const f = fixture(identity); await f.seed();
  jest.setSystemTime(now + ttl - 1);
  expect((await f.store.getSnapshot(identity, 'store'))?.items).toHaveLength(1);
  jest.setSystemTime(now + ttl);
  expect(await f.store.getSnapshot(identity, 'store')).toMatchObject({ items: [], expired: true });
  expect(f.tx.savedCart.update).not.toHaveBeenCalled();
});

it('GET and identical PUT leave expiry and updatedAt unchanged; changed content refreshes them', async () => {
  const f = fixture(guest); await f.seed(); const before = structuredClone(f.rows()[0]);
  jest.setSystemTime(now + 1000);
  await f.store.getSnapshot(guest, 'store'); await f.store.saveSnapshot(guest, 'store', input);
  expect(f.tx.savedCart.update).not.toHaveBeenCalled(); expect(f.rows()[0]).toEqual(before);
  await f.store.saveSnapshot(guest, 'store', { ...input, scheduled_for: '2026-10-24T17:00:00Z' });
  expect(f.rows()[0].expiresAt.getTime()).toBe(now + 1000 + GUEST_CART_TTL_MS);
});

it.each([CUSTOMER_CART_TTL_MS - 1, CUSTOMER_CART_TTL_MS])('handles legacy null expiry at age %i without a backfill', async age => {
  const f = fixture(user, { expiry: null, updatedAt: new Date(now - age) }); await f.seed();
  const snapshot = await f.store.getSnapshot(user, 'store');
  expect(snapshot?.items.length).toBe(age < CUSTOMER_CART_TTL_MS ? 1 : 0);
  expect(f.tx.savedCart.update).not.toHaveBeenCalled();
});

it('a real legacy save records the customer deadline', async () => {
  const f = fixture(user, { expiry: null }); await f.seed();
  await f.store.saveSnapshot(user, 'store', { ...input, driver_tip_percent: '10' });
  expect(f.rows()[0].expiresAt.getTime()).toBe(now + CUSTOMER_CART_TTL_MS);
});

it('guest rows with no usable timestamps are expired', async () => {
  const f = fixture(guest, { expiry: null, updatedAt: null }); await f.seed();
  expect(await f.store.getSnapshot(guest, 'store')).toMatchObject({ expired: true, items: [] });
});

it('concurrent fresh saves reuse the expired ACTIVE row without unique failures or old items', async () => {
  const f = fixture(user, { expiry: new Date(now) }); await f.seed();
  const changed = { ...input, items: [{ ...input.items[0], key: 'new', quantity: 4 }] };
  await Promise.all([f.store.saveSnapshot(user, 'store', changed), f.store.getSnapshot(user, 'store'), f.store.saveSnapshot(user, 'store', changed)]);
  expect(f.rows()).toHaveLength(1); expect(f.rows()[0].items.map((item: any) => item.lineKey)).toEqual(['new']);
  expect(f.tx.savedCart.create).not.toHaveBeenCalled(); expect(f.tx.$queryRaw).toHaveBeenCalledTimes(2);
  expect(f.rows()[0].expiresAt.getTime()).toBe(now + CUSTOMER_CART_TTL_MS);
});

it.each([true, false])('merges only usable guests (expired=%s), and repeated merge is idempotent', async expired => {
  const f = fixture(guest, { expiry: new Date(now + (expired ? 0 : 1000)) }); await f.seed();
  const result = await f.store.mergeGuestIntoUser('a'.repeat(64), 'customer', 'store');
  expect(result.mergeOutcome).toBe(expired ? 'no_guest' : 'merged');
  if (!expired) {
    expect(result.snapshot?.items).toHaveLength(1);
    expect(result.snapshot?.expires_at).toBe(new Date(now + CUSTOMER_CART_TTL_MS).toISOString());
    expect((await f.store.mergeGuestIntoUser('a'.repeat(64), 'customer', 'store')).mergeOutcome).toBe('no_guest');
  } else expect(f.tx.savedCart.deleteMany).not.toHaveBeenCalled();
});

it('valid guest replaces an expired user cart without restoring stale lines or creating a second ACTIVE row', async () => {
  const f = fixture(user, { expiry: new Date(now) }); await f.seed();
  await f.store.saveSnapshot(guest, 'store', { ...input, items: [{ ...input.items[0], key: 'guest' }] });
  const result = await f.store.mergeGuestIntoUser('a'.repeat(64), 'customer', 'store');
  expect(result.snapshot?.items.map(item => item.key)).toEqual(['guest']); expect(f.rows()).toHaveLength(1);
});

it('merging an expired guest into an empty user cart returns an expiry marker for native fallback protection', async () => {
  const f = fixture(guest, { expiry: new Date(now) }); await f.seed();
  await f.store.saveSnapshot(user, 'store', { ...input, items: [] });
  const result = await f.store.mergeGuestIntoUser('a'.repeat(64), 'customer', 'store');
  expect(result.snapshot).toMatchObject({ items: [], expired: true });
});

it('an empty guest merge that changes no customer content does not restart inactivity', async () => {
  const f = fixture(user); await f.seed(); const expiresAt = f.rows()[0].expiresAt;
  jest.setSystemTime(now + 1000);
  await f.store.saveSnapshot(guest, 'store', { ...input, items: [] });
  await f.store.mergeGuestIntoUser('a'.repeat(64), 'customer', 'store');
  expect(f.rows()[0].expiresAt).toEqual(expiresAt);
});

it('expired clear/conversion is a no-op and a usable checkout conversion remains hidden', async () => {
  const f = fixture(user, { expiry: new Date(now) }); await f.seed();
  await f.store.clear(user, 'store'); await f.store.markConverted(user, 'store');
  expect(f.tx.savedCart.update).not.toHaveBeenCalled(); expect(f.tx.savedCart.deleteMany).not.toHaveBeenCalled();
  await f.store.saveSnapshot(user, 'store', input); await f.store.markConverted(user, 'store');
  expect(f.rows()[0].status).toBe('CONVERTED'); expect(await f.store.getSnapshot(user, 'store')).toBeNull();
});

it('keeps locations and accounts isolated', async () => {
  const f = fixture(); await f.seed();
  expect(await f.store.getSnapshot({ kind: 'user', userId: 'other' }, 'store')).toBeNull();
  expect(await f.store.getSnapshot(user, 'other-store')).toBeNull();
});

it('refreshes protected guest cookies only on saves, using the stored deadline even for identical PUTs', async () => {
  const f = fixture(guest); await f.seed();
  const service = new SavedCartService(f.store);
  const request = { cookies: { w4u_guest_cart: 'a'.repeat(64) } } as never;
  expect((await service.getForRequest(request, 'store')).cookies).toEqual([]);
  jest.setSystemTime(now + 1000);
  const result = await service.saveForRequest(request, 'store', input);
  expect(result.cookies).toEqual([{ action: 'set', name: 'w4u_guest_cart', token: 'a'.repeat(64), expiresAt: new Date(now + GUEST_CART_TTL_MS).toISOString() }]);
  const response = { cookie: jest.fn() };
  setGuestTokenCookie(response as never, 'token', result.snapshot.expires_at);
  expect(response.cookie).toHaveBeenCalledWith('w4u_guest_cart', 'token', expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: GUEST_CART_TTL_MS - 1000 }));
});
