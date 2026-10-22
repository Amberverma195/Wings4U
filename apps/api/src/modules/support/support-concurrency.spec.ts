jest.mock("../../database/prisma.service", () => ({ PrismaService: class {} }));
import { SupportService } from "./support.service";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function harness(status = 'OPEN') {
  let committed: any = { id: 'ticket', customerUserId: 'customer', locationId: 'location', createdSource: 'CUSTOMER_APP', status,
    subject: 'Concern', messages: [{ id: 'history', messageBody: 'Original concern' }], events: [], resolutions: [], createdAt: new Date() };
  let tail = Promise.resolve();
  let pause: { acquired: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred> } | null = null;
  let failEvent = false;
  const clone = (row: any) => ({ ...row, messages: [...row.messages], events: [...row.events], resolutions: [...row.resolutions] });
  const limiter = { enforce: jest.fn(async () => {}) };
  const db: any = {
    supportTicket: { findUnique: jest.fn(async () => clone(committed)),
      findMany: jest.fn(async ({ where }: any) => !where.status || committed.status === where.status ? [clone(committed)] : []) },
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      if (typeof work !== 'function') throw new Error('Expected transaction callback; lazy writes must follow the lock');
      let release: (() => void) | undefined, view: any, locked = false;
      const check = () => { if (!locked) throw new Error('Mutable ticket reads/writes require the row lock'); };
      const tx: any = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray, id: string) => {
          expect(strings.join('?')).toContain('FROM support_tickets'); expect(strings.join('?')).toContain('FOR UPDATE'); expect(id).toBe('ticket');
          const previous = tail; const done = deferred(); tail = done.promise; release = done.resolve; await previous;
          locked = true; view = clone(committed);
          const gate = pause; pause = null;
          if (gate) { gate.acquired.resolve(); await gate.resume.promise; }
          return [{ id: 'ticket' }];
        }),
        supportTicket: {
          findUnique: async () => { check(); return clone(view); },
          update: async ({ data }: any) => { check(); Object.assign(view, data); return clone(view); },
          updateMany: async ({ where, data }: any) => { check(); if (!where.status.in.includes(view.status)) return { count: 0 }; Object.assign(view, data); return { count: 1 }; },
        },
        supportTicketMessage: { create: async ({ data }: any) => { check(); const row = { ...data, id: 'new-message', createdAt: new Date() }; view.messages.push(row); return row; } },
        supportTicketEvent: { create: async ({ data }: any) => { check(); if (failEvent) throw new Error('Audit persistence failed'); view.events.push(data); return data; } },
        supportTicketResolution: { create: async ({ data }: any) => { check(); view.resolutions.push(data); return data; } },
      };
      try { const result = await work(tx); if (view) committed = view; return result; } finally { release?.(); }
    },
  };
  return { service: new SupportService(db, limiter as never), limiter, row: () => committed,
    pauseNextLock: () => { pause = { acquired: deferred(), resume: deferred() }; return pause; },
    failAudit: () => { failEvent = true; } };
}
const customerMessage = (service: SupportService) => service.addMessage('ticket', 'customer', 'New details', false, 'CUSTOMER', 'location');
const staffMessage = (service: SupportService) => service.addMessage('ticket', 'admin', 'Staff note', true, 'ADMIN', 'location');
const transition = (service: SupportService, status: string) => status === 'RESOLVED'
  ? service.resolve('ticket', 'admin', 'INFO_ONLY', 'Handled', 'location')
  : service.updateStatus('ticket', 'admin', status, 'location');

it.each(['RESOLVED', 'CLOSED'])('rejects a customer reply if staff %s acquires the lock first, even after the precheck', async status => {
  const h = harness(); const gate = h.pauseNextLock();
  const staff = transition(h.service, status); await gate.acquired.promise;
  const reply = customerMessage(h.service); const results = Promise.allSettled([staff, reply]);
  gate.resume.resolve();
  const done = await results; expect(done[0].status).toBe('fulfilled'); expect(done[1]).toMatchObject({ status: 'rejected', reason: { status: 409 } });
  expect(h.row().status).toBe(status); expect(h.row().messages).toHaveLength(1);
  expect(h.row().events.filter((e: any) => e.eventType === 'MESSAGE_ADDED')).toHaveLength(0);
});
it.each(['RESOLVED', 'CLOSED'])('commits a customer reply atomically before staff %s when the reply wins the lock', async status => {
  const h = harness(); const gate = h.pauseNextLock();
  const reply = customerMessage(h.service); await gate.acquired.promise;
  const staff = transition(h.service, status); gate.resume.resolve(); await Promise.all([reply, staff]);
  expect(h.row().messages).toHaveLength(2); expect(h.row().status).toBe(status);
  expect(h.row().events.filter((e: any) => e.eventType === 'MESSAGE_ADDED')).toHaveLength(1);
  expect(h.limiter.enforce.mock.calls).toHaveLength(2);
});
it.each([true, false])('rechecks staff/reopen transitions under the same lock, reopen first: %s', async reopenFirst => {
  const h = harness('CLOSED'); const gate = h.pauseNextLock();
  const reopen = () => h.service.reopenTicket('ticket', 'customer', 'location');
  const staff = () => h.service.updateStatus('ticket', 'admin', 'IN_REVIEW', 'location');
  const first = reopenFirst ? reopen() : staff(); await gate.acquired.promise;
  const second = reopenFirst ? staff() : reopen(); gate.resume.resolve(); await Promise.all([first, second]);
  expect(h.row().status).toBe('IN_REVIEW');
  const reopened = h.row().events.filter((e: any) => e.note === 'Reopened by customer');
  expect(reopened).toHaveLength(reopenFirst ? 1 : 0);
  if (reopenFirst) expect(h.row().events.at(-1)).toMatchObject({ fromValue: 'OPEN', toValue: 'IN_REVIEW' });
});
it('creates one reopening event under simultaneous attempts and returns to the active queue', async () => {
  const h = harness('RESOLVED'); await Promise.all([h.service.reopenTicket('ticket', 'customer', 'location'), h.service.reopenTicket('ticket', 'customer', 'location')]);
  expect(h.row().events.filter((e: any) => e.note === 'Reopened by customer')).toHaveLength(1);
  expect(h.row().messages[0].id).toBe('history');
  expect((await h.service.listTickets({ locationId: 'location', status: 'OPEN' })).tickets).toHaveLength(1);
});
it.each(['RESOLVED', 'CLOSED'])('allows atomic staff internal notes while the status changes to %s', async status => {
  const h = harness(); const gate = h.pauseNextLock(); const staff = transition(h.service, status); await gate.acquired.promise;
  const note = staffMessage(h.service); gate.resume.resolve(); await Promise.all([staff, note]);
  expect(h.row().status).toBe(status); expect(h.row().messages[1].isInternalNote).toBe(true);
  expect(h.row().events.filter((e: any) => e.eventType === 'MESSAGE_ADDED')).toEqual([expect.objectContaining({ payloadJson: { is_internal_note: true } })]);
});
it('keeps ownership, location and internal-alert access checks before writes', async () => {
  const h = harness();
  await expect(h.service.addMessage('ticket', 'attacker', 'No', false, 'CUSTOMER', 'location')).rejects.toMatchObject({ status: 403 });
  await expect(h.service.addMessage('ticket', 'customer', 'No', false, 'CUSTOMER', 'other-location')).rejects.toMatchObject({ status: 403 });
  h.row().createdSource = 'SYSTEM_OVERDUE_DELIVERY';
  await expect(customerMessage(h.service)).rejects.toMatchObject({ status: 403 });
  await expect(h.service.reopenTicket('ticket', 'customer', 'location')).rejects.toMatchObject({ status: 403 });
  expect(h.row().messages).toHaveLength(1); expect(h.row().events).toHaveLength(0);
});
it('rolls back a message when its audit insert fails', async () => {
  const h = harness(); h.failAudit(); await expect(customerMessage(h.service)).rejects.toThrow('Audit persistence failed');
  expect(h.row().messages).toHaveLength(1); expect(h.row().events).toHaveLength(0);
});
