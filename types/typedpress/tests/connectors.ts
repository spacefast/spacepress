// connectors.call and connectors.enqueue (www/content/docs/reference/host-contract.md, `sp_connectors_call`).
import { connectors } from "typedpress";

export const now: Promise<unknown> = connectors.call("crm", "find", { q: "ada" });
export const bare: Promise<unknown> = connectors.call("crm", "ping");
export const queued: Promise<{ id: string }> = connectors.enqueue("fulfilment", "create_shipment", { order: "A-1" }, { key: "ship-A-1", delay: 30 });
export const minimal: Promise<{ id: string }> = connectors.enqueue("fulfilment", "ping");

// @ts-expect-error the role is a string
export const wrongRole = connectors.call(42, "find");
// @ts-expect-error enqueue options are key and delay
export const wrongOption = connectors.enqueue("fulfilment", "create_shipment", {}, { retries: 3 });
// @ts-expect-error call takes no options
export const callOptions = connectors.call("crm", "find", {}, { key: "x" });
