import { startPrintAgent } from "./server";

void startPrintAgent().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[print-agent] fatal error during startup:", err);
  process.exit(1);
});
