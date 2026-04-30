import { describeDrawerCommands } from "./drawer";
import { describePrintQueue } from "./queue";
import { describePrinterDiscovery } from "./printers";
import { loadConfig } from "./config";
import { loginAsKdsStation } from "./auth";
import { createPrintAgentSocket, subscribeOrdersChannel } from "./socket";

interface OrderEventPayload {
  event_type: string;
  payload: {
    order_id?: string;
    order_number?: number;
    [key: string]: unknown;
  };
  timestamp: string;
}

export async function startPrintAgent(): Promise<void> {
  const modules = [
    describePrinterDiscovery(),
    describePrintQueue(),
    describeDrawerCommands(),
  ];

  // eslint-disable-next-line no-console
  console.log("Wings4U print agent scaffold started.");
  // eslint-disable-next-line no-console
  console.log(modules.join("\n"));

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[print-agent] realtime disabled: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[print-agent] connecting to ${config.apiOrigin} for location ${config.locationId}`,
  );

  let cookieHeader: string;
  try {
    cookieHeader = await loginAsKdsStation(config);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[print-agent] KDS station login failed, realtime disabled: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }

  const socket = createPrintAgentSocket(config, cookieHeader);

  socket.on("connect", () => {
    // eslint-disable-next-line no-console
    console.log(`[print-agent] socket connected (id=${socket.id})`);
  });

  socket.on("disconnect", (reason: string) => {
    // eslint-disable-next-line no-console
    console.warn(`[print-agent] socket disconnected: ${reason}`);
  });

  socket.on("connect_error", (err: Error) => {
    // eslint-disable-next-line no-console
    console.warn(`[print-agent] connect_error: ${err.message}`);
  });

  socket.on("order.accepted", (event: OrderEventPayload) => {
    const orderId = event?.payload?.order_id ?? "(unknown)";
    const orderNumber = event?.payload?.order_number;
    // eslint-disable-next-line no-console
    console.log(
      `[print-agent] order.accepted received (order_id=${orderId}${
        orderNumber != null ? `, order_number=${orderNumber}` : ""
      }) - enqueueing print job`,
    );
    // eslint-disable-next-line no-console
    console.log(`[print-agent] queue: ${describePrintQueue()}`);
  });

  subscribeOrdersChannel(socket, config.locationId);
  socket.connect();

  const shutdown = () => {
    // eslint-disable-next-line no-console
    console.log("[print-agent] shutting down");
    socket.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
