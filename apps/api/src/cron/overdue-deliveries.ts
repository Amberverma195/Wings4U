import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { OverdueDeliveryJob } from "../modules/kds/overdue-delivery.job";
import { OverdueDeliveriesCronModule } from "./overdue-deliveries.module";

const logger = new Logger("OverdueDeliveriesCron");

export async function runOverdueDeliveriesCron(): Promise<number> {
  const app = await NestFactory.createApplicationContext(
    OverdueDeliveriesCronModule,
  );
  try {
    const createdCount = await app.get(OverdueDeliveryJob).runOnce();
    logger.log(`Completed overdue-delivery check; created ${createdCount} ticket(s)`);
    return createdCount;
  } finally {
    await app.close();
  }
}

export async function runOverdueDeliveriesCli(
  runCron: () => Promise<number> = runOverdueDeliveriesCron,
): Promise<void> {
  try {
    await runCron();
  } catch (err) {
    logger.error(
      `Overdue-delivery cron failed: ${(err as Error).message}`,
      (err as Error).stack,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void runOverdueDeliveriesCli();
}
