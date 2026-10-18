jest.mock('../../database/prisma.service', () => ({ PrismaService: class {} }));
import { OrdersService } from './orders.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function row(n: number, changes: Record<string, unknown> = {}): any {
  return { id: id(n), orderNumber: BigInt(n), customerUserId: 'a', locationId: 'store', status: 'DELIVERED',
    placedAt: new Date(Date.UTC(2026, 9, 18, 16, 0, Math.floor((n - 1) / 25))), fulfillmentType: 'PICKUP', ...changes };
}
function fixture(rows = Array.from({ length: 65 }, (_, i) => row(i + 1))) {
  const matches = (value: any, where: any): boolean => Object.entries(where).every(([key, expected]: [string, any]) =>
    key === 'placedAt' ? value.placedAt >= expected.gte && value.placedAt < expected.lt : value[key] === expected);
  let queryCount = 0;
  // Interpret the requested Prisma ordering/filter/cursor/skip/take over fixtures.
  // Without a unique tie-breaker, deliberately vary tied rows between queries.
  const db = { order: {
    findFirst: jest.fn(async (args: any) => rows.find(value => matches(value, args.where)) ?? null),
    findMany: jest.fn(async (args: any) => {
      queryCount++;
      const orderBy = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
      const sorted = rows.filter(value => matches(value, args.where)).sort((left, right) => {
        for (const field of orderBy) {
          const [key, direction] = Object.entries(field)[0];
          const a = left[key] instanceof Date ? left[key].getTime() : left[key];
          const b = right[key] instanceof Date ? right[key].getTime() : right[key];
          if (a !== b) return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1);
        }
        return left.id.localeCompare(right.id) * (queryCount % 2 ? 1 : -1);
      });
      const anchor = args.cursor ? sorted.findIndex(value => value.id === args.cursor.id) : 0;
      if (anchor < 0) return [];
      const start = anchor + (args.skip ?? 0);
      return sorted.slice(start, start + args.take);
    }),
  }, location: { findUnique: jest.fn().mockResolvedValue({ timezoneName: 'America/Toronto' }) } };
  const chat = { getUnreadCountsForOrders: jest.fn(async () => new Map()) };
  const service = new OrdersService(db as never, chat as never, {} as never, {} as never, {} as never, {} as never);
  const run = (params: Record<string, unknown> = {}) => service.listOrders({ userId: 'a', userRole: 'CUSTOMER', locationId: 'store', ...params });
  return { rows, db, run };
}
describe('deterministic scoped customer history pagination', () => {
  it('walks equal-timestamp boundaries with default pages of 20 and no missing or repeated rows', async () => {
    const f = fixture(), seen: string[] = [], sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const result = await f.run(cursor ? { cursor } : {});
      sizes.push(result.orders.length); seen.push(...result.orders.map(order => order.id as string));
      if (result.next_cursor) expect(result.next_cursor).toBe(result.orders.at(-1)?.id);
      cursor = result.next_cursor;
    } while (cursor);
    const expected = [...f.rows].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime() || b.id.localeCompare(a.id)).map(value => value.id);
    expect(sizes).toEqual([20, 20, 20, 5]); expect(seen).toEqual(expected); expect(new Set(seen).size).toBe(65);
    expect(f.db.order.findMany.mock.calls[0][0]).toMatchObject({ take: 21, orderBy: [{ placedAt: 'desc' }, { id: 'desc' }] });
    expect(f.db.order.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: seen[19] }, skip: 1 });
  });
  it('all identical timestamps paginate solely by descending unique ID', async () => {
    const f = fixture(Array.from({ length: 45 }, (_, i) => row(i + 1, { placedAt: new Date('2026-10-18T16:00:00Z') })));
    const one = await f.run(), two = await f.run({ cursor: one.next_cursor }), three = await f.run({ cursor: two.next_cursor });
    expect([...one.orders, ...two.orders, ...three.orders].map(order => order.id)).toEqual(Array.from({ length: 45 }, (_, i) => id(45 - i)));
    expect(three.orders).toHaveLength(5); expect(three.next_cursor).toBeNull();
  });
  it('an exact final page has no continuation cursor; page size cap stays 50', async () => {
    const f = fixture(Array.from({ length: 40 }, (_, i) => row(i + 1)));
    const first = await f.run(), last = await f.run({ cursor: first.next_cursor }); expect(last.orders).toHaveLength(20); expect(last.next_cursor).toBeNull();
    const capped = fixture(); const result = await capped.run({ limit: 500 }); expect(result.orders).toHaveLength(50);
    expect(capped.db.order.findMany.mock.calls[0][0].take).toBe(51);
  });
  it('preserves the selected status, customer and location across all pages', async () => {
    const rows = Array.from({ length: 34 }, (_, i) => row(i + 1));
    rows.push(row(100, { customerUserId: 'b' }), row(101, { locationId: 'other' }), row(102, { status: 'PREPARING' }));
    const f = fixture(rows), one = await f.run({ status: 'DELIVERED' }), two = await f.run({ status: 'DELIVERED', cursor: one.next_cursor });
    expect([...one.orders, ...two.orders]).toHaveLength(34);
    expect([...one.orders, ...two.orders].some(order => [id(100), id(101), id(102)].includes(order.id as string))).toBe(false);
    expect(f.db.order.findFirst.mock.calls[0][0].where).toEqual({ customerUserId: 'a', locationId: 'store', status: 'DELIVERED', id: one.next_cursor });
  });
  it('local date filters scope both the cursor and page boundaries', async () => {
    const f = fixture([row(1, { placedAt: new Date('2026-10-18T03:59:59Z') }), row(2, { placedAt: new Date('2026-10-18T04:00:00Z') }),
      row(3, { placedAt: new Date('2026-10-19T03:59:59Z') }), row(4, { placedAt: new Date('2026-10-19T04:00:00Z') })]);
    const first = await f.run({ placedOn: '2026-10-18', limit: 1 });
    const last = await f.run({ placedOn: '2026-10-18', limit: 1, cursor: first.next_cursor });
    expect([...first.orders, ...last.orders].map(order => order.id)).toEqual([id(3), id(2)]); expect(last.next_cursor).toBeNull();
    expect(f.db.order.findFirst.mock.calls[0][0].where.placedAt).toEqual({ gte: new Date('2026-10-18T04:00:00Z'), lt: new Date('2026-10-19T04:00:00Z') });
  });
  it.each(['malformed', 'deleted', 'customer', 'location', 'status', 'date'])('rejects a %s cursor without querying or revealing a foreign page', async issue => {
    const f = fixture(); let cursor = id(1); const params: Record<string, unknown> = {};
    if (issue === 'malformed') cursor = 'invalid';
    if (issue === 'deleted') cursor = id(999);
    if (issue === 'customer') f.rows[0].customerUserId = 'b';
    if (issue === 'location') f.rows[0].locationId = 'other';
    if (issue === 'status') params.status = 'PREPARING';
    if (issue === 'date') params.placedOn = '2026-10-17';
    await expect(f.run({ ...params, cursor })).rejects.toMatchObject({ status: 400, message: 'Invalid order cursor. Refresh your order history and try again.' });
    expect(f.db.order.findMany).not.toHaveBeenCalled();
  });
  it('preserves staff/admin access and the explicit mine filter', async () => {
    const f = fixture([row(1), row(2, { customerUserId: 'b' })]);
    expect((await f.run({ userRole: 'STAFF' })).orders).toHaveLength(2);
    expect((await f.run({ userRole: 'ADMIN', mine: true })).orders.map(order => order.id)).toEqual([id(1)]);
  });
  it('empty history preserves the orders/next_cursor response contract', async () => {
    expect(await fixture([]).run()).toEqual({ orders: [], next_cursor: null });
  });
});
