import { describeDrawerCommands } from "./drawer";
import { describePrintQueue } from "./queue";
import { describePrinterDiscovery } from "./printers";

export function startPrintAgent() {
  const modules = [
    describePrinterDiscovery(),
    describePrintQueue(),
    describeDrawerCommands()
  ];

  console.log("Wings4U print agent scaffold started.");
  console.log(modules.join("\n"));
}
