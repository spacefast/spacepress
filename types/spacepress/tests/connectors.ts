// connectors.call and connectors.enqueue via MutationCtx.
import { mutation, type Connectors } from "spacepress";

export const checkConnectors = mutation({ access: "admin" }, ({ connectors }) => {
  const now: Promise<unknown> = connectors.call("crm", "find", { q: "ada" });
  const bare: Promise<unknown> = connectors.call("crm", "ping");
  const queued: Promise<{ id: string }> = connectors.enqueue("fulfilment", "create_shipment", { order: "A-1" }, { key: "ship-A-1", delay: 30 });
  const minimal: Promise<{ id: string }> = connectors.enqueue("fulfilment", "ping");

  // @ts-expect-error the role is a string
  const wrongRole = connectors.call(42, "find");
  // @ts-expect-error enqueue options are key and delay
  const wrongOption = connectors.enqueue("fulfilment", "create_shipment", {}, { retries: 3 });
  // @ts-expect-error call takes no options
  const callOptions = connectors.call("crm", "find", {}, { key: "x" });
  void [now, bare, queued, minimal, wrongRole, wrongOption, callOptions];
  return true;
});

declare const c: Connectors;
void c;
