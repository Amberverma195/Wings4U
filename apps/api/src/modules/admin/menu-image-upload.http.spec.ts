import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AdminMenuController } from "./admin-menu.controller";
import { AdminMenuService } from "./admin-menu.service";
import { MAX_MENU_IMAGE_BYTES } from "./menu-image-upload";
import { PrismaService } from "../../database/prisma.service";
import { AuthGuard } from "../../common/guards/auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { SessionValidator } from "../../common/session/session-validator.service";
import { configureApp } from "../../app.setup";

const LOCATION = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YGpRzQAAAAASUVORK5CYII=', 'base64');

describe("Menu-image multipart parsing with real admin guards/service and mocked persistence", () => {
  let app: INestApplication;
  const item: any = { id: ITEM, slug: "wings", imageUrl: "/uploads/menu/existing.png" };
  const db: any = {
    menuItem: { findFirst: jest.fn(async ({ where }: any) => where.id === ITEM && where.locationId === LOCATION ? { ...item } : null),
      findMany: jest.fn(async () => [{ ...item }]), update: jest.fn(async ({ data }: any) => Object.assign(item, data)) },
    menuCategory: { findFirst: jest.fn(async ({ where }: any) => where.id === CATEGORY && where.locationId === LOCATION ? { id: CATEGORY, slug: 'wings', name: 'Wings' } : null) },
    $transaction: jest.fn(async (operations: any[]) => Promise.all(operations)),
  };
  const storage = { save: jest.fn(async (_slug: string, _buffer: Buffer, _name: string) => '/uploads/menu/new.png'), remove: jest.fn() };
  const service = new AdminMenuService(db, { invalidateLocation: jest.fn() } as never,
    { revalidateLocation: jest.fn() } as never, { emitCatalogUpdated: jest.fn() } as never);
  (service as any).imageStorage = storage;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [AdminMenuController], providers: [
      { provide: AdminMenuService, useValue: service }, { provide: PrismaService, useValue: db },
      { provide: SessionValidator, useValue: { resolve: async (token?: string) => token ? { userId: token, role: token === 'admin' ? 'ADMIN' : token === 'staff' ? 'STAFF' : 'CUSTOMER', locationId: LOCATION } : null } },
      { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: RolesGuard },
    ] }).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
  });
  beforeEach(() => { jest.clearAllMocks(); item.imageUrl = '/uploads/menu/existing.png'; });
  afterAll(async () => app?.close());
  const post = (endpoint: string, token = 'admin') => {
    const call = request(app.getHttpServer()).post('/api/v1/admin/menu/' + endpoint).set('X-Location-Id', LOCATION);
    return token ? call.auth(token, { type: 'bearer' }) : call;
  };
  const endpoints = ['items/' + ITEM + '/image', 'categories/' + CATEGORY + '/builder-image'];

  it.each(endpoints)("accepts small image uploads at %s, preserving storage and location scoping", async endpoint => {
    const response = await post(endpoint).attach('image', image, { filename: 'test.png', contentType: 'image/png' }).expect(201);
    expect(response.body.data.image_url).toBe('/uploads/menu/new.png');
    expect(storage.save).toHaveBeenCalledWith('wings', image, 'test.png');
    expect(db.menuItem.update).toHaveBeenCalledWith({ where: { id: ITEM }, data: { imageUrl: '/uploads/menu/new.png' } });
    const model = endpoint.startsWith('items') ? db.menuItem : db.menuCategory;
    expect(model.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ locationId: LOCATION }) }));
  });
  it.each(endpoints)("accepts exactly 4 MiB at %s", async endpoint => {
    await post(endpoint).attach('image', Buffer.alloc(MAX_MENU_IMAGE_BYTES), { filename: 'boundary.webp', contentType: 'image/webp' }).expect(201);
    expect(storage.save.mock.calls[0][1].length).toBe(MAX_MENU_IMAGE_BYTES);
  });
  it.each(endpoints)("returns 413 for oversized %s before persistence", async endpoint => {
    const response = await post(endpoint).attach('image', Buffer.alloc(MAX_MENU_IMAGE_BYTES + 1), { filename: 'oversize.jpg', contentType: 'image/jpeg' }).expect(413);
    expect(response.body.errors[0].code).toBe('PAYLOAD_TOO_LARGE');
    expect(storage.save).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled(); expect(db.menuItem.update).not.toHaveBeenCalled();
  });
  it.each(endpoints)("rejects anonymous, customer and staff attempts at %s", async endpoint => {
    for (const [token, status] of [['', 401], ['customer', 403], ['staff', 403]] as const) await post(endpoint, token).attach('image', image, { filename: 'test.png', contentType: 'image/png' }).expect(status);
    expect(storage.save).not.toHaveBeenCalled();
  });
  it("preserves missing/invalid image and foreign-item validation", async () => {
    await post(endpoints[0]).attach('image', Buffer.from('text'), { filename: 'bad.txt', contentType: 'text/plain' }).expect(400);
    await post('items/44444444-4444-4444-8444-444444444444/image').attach('image', image, { filename: 'test.png', contentType: 'image/png' }).expect(404);
    await post(endpoints[0]).expect(400);
    expect(storage.save).not.toHaveBeenCalled();
  });
  it("still returns an existing builder image without rewriting storage", async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/admin/menu/categories/' + CATEGORY + '/builder-image').set('X-Location-Id', LOCATION).auth('admin', { type: 'bearer' }).expect(200);
    expect(response.body.data.image_url).toBe('/uploads/menu/existing.png'); expect(storage.save).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
  });
});
