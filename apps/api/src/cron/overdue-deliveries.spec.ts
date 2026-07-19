import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  runOverdueDeliveriesCli,
  runOverdueDeliveriesCron,
} from "./overdue-deliveries";

jest.mock("@nestjs/core", () => ({
  NestFactory: { createApplicationContext: jest.fn() },
}));

describe("overdue-deliveries cron entrypoint", () => {
  const createApplicationContext =
    NestFactory.createApplicationContext as jest.Mock;

  afterEach(() => {
    jest.restoreAllMocks();
    createApplicationContext.mockReset();
    process.exitCode = undefined;
  });

  it("runs once and always closes the application context", async () => {
    const runOnce = jest.fn().mockResolvedValue(2);
    const close = jest.fn().mockResolvedValue(undefined);
    createApplicationContext.mockResolvedValue({
      get: jest.fn().mockReturnValue({ runOnce }),
      close,
    });

    await expect(runOverdueDeliveriesCron()).resolves.toBe(2);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the application context when the job fails", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    createApplicationContext.mockResolvedValue({
      get: jest.fn().mockReturnValue({
        runOnce: jest.fn().mockRejectedValue(new Error("database unavailable")),
      }),
      close,
    });

    await expect(runOverdueDeliveriesCron()).rejects.toThrow("database unavailable");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("sets a failing process exit status", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    await runOverdueDeliveriesCli(
      jest.fn().mockRejectedValue(new Error("database unavailable")),
    );

    expect(process.exitCode).toBe(1);
  });
});
