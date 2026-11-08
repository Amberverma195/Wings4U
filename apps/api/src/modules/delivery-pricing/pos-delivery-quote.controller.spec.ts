import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApp } from "../../app.setup";
import { LocationScopeGuard } from "../../common/guards/location-scope.guard";
import { PosStationGuard } from "../../common/guards/pos-station.guard";
import { StoreNetworkGuard } from "../../common/guards/store-network.guard";
import { PosController } from "../pos/pos.controller";
import { PosService } from "../pos/pos.service";
import { DeliveryPricingService } from "./delivery-pricing.service";

describe("station-protected delivery quoting", () => {
  let app: INestApplication;
  let stationAllowed = true, networkAllowed = true;
  const createQuote = jest.fn().mockResolvedValue({ delivery_quote_token: "signed", delivery_fee_cents: 1700 });
  const address = { line1: "123 Example Street", city: "London", postal_code: "N6K 1A1" };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [PosController], providers: [
      { provide: PosService, useValue: {} }, { provide: DeliveryPricingService, useValue: { createQuote } },
    ] }).overrideGuard(LocationScopeGuard).useValue({ canActivate: (context: ExecutionContext) => {
      context.switchToHttp().getRequest().locationId = "trusted-location"; return true;
    } }).overrideGuard(PosStationGuard).useValue({ canActivate: () => stationAllowed })
      .overrideGuard(StoreNetworkGuard).useValue({ canActivate: () => networkAllowed }).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
  });
  beforeEach(() => { stationAllowed = true; networkAllowed = true; createQuote.mockClear(); });
  afterAll(async () => { await app.close(); });

  it("uses the authoritative pricing service and guarded location for staff quotes", async () => {
    const result = await request(app.getHttpServer()).post("/api/v1/pos/delivery/quote")
      .send({ address_snapshot_json: address }).expect(201);
    expect(result.body.data.delivery_fee_cents).toBe(1700);
    expect(createQuote).toHaveBeenCalledWith({ locationId: "trusted-location", addressSnapshotJson: address });
  });

  it.each(["station", "network"])("rejects requests without %s authorization", async denied => {
    if (denied === "station") stationAllowed = false; else networkAllowed = false;
    await request(app.getHttpServer()).post("/api/v1/pos/delivery/quote")
      .send({ address_snapshot_json: address }).expect(403);
    expect(createQuote).not.toHaveBeenCalled();
  });
});
