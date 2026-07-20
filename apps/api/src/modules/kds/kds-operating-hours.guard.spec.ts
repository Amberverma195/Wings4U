import { ForbiddenException } from "@nestjs/common";
import { KdsOperatingHoursGuard } from "./kds-operating-hours.guard";

function createContext(locationId = "location-1") {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ locationId }),
    }),
  };
}

describe("KdsOperatingHoursGuard", () => {
  it("allows the schedule route outside operating hours", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) };
    const operatingHours = { mayOperate: jest.fn() };
    const guard = new KdsOperatingHoursGuard(
      reflector as never,
      operatingHours as never,
    );

    await expect(guard.canActivate(createContext() as never)).resolves.toBe(true);
    expect(operatingHours.mayOperate).not.toHaveBeenCalled();
  });

  it("rejects KDS REST operations while closed with no active tickets", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const operatingHours = {
      mayOperate: jest.fn().mockResolvedValue({ allowed: false }),
    };
    const guard = new KdsOperatingHoursGuard(
      reflector as never,
      operatingHours as never,
    );

    await expect(guard.canActivate(createContext() as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("allows REST operations while draining active tickets", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const operatingHours = {
      mayOperate: jest.fn().mockResolvedValue({
        allowed: true,
        draining: true,
        closesAt: null,
      }),
    };
    const guard = new KdsOperatingHoursGuard(
      reflector as never,
      operatingHours as never,
    );

    await expect(guard.canActivate(createContext() as never)).resolves.toBe(true);
  });
});
