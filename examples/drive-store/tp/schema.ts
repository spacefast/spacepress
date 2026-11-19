import { global, integer, number, order, product, select, store, table, text, timestamp } from "typedpress";

export const MEDIA = ["hdd", "ssd", "nvme"] as const;
export const CONDITIONS = ["like-new", "good", "fair", "for-parts"] as const;
export const CURRENCY = "USD";

export const shop = store({
  currency: CURRENCY,
  country: "US",
  sellTo: ["US"],
  shipping: [{ name: "United States", countries: ["US"], methods: [
    { type: "flatRate", title: "Ground shipping", cost: "8.00" },
  ] }],
  payments: ["cod"],
});

export const drives = product({
  label: "Drives",
  url: "/drives/:slug",
  sync: "content/drives/*.md",
  inventory: true,
  reviews: true,
  fields: {
    brand: text().max(60).optional().ui({ label: "Brand", width: 50 }),
    model: text().max(80).optional().ui({ label: "Model", width: 50 }),
    capacityGb: integer().min(1).max(100_000).optional().ui({ label: "Capacity (GB)", width: 33 }),
    media: select(MEDIA).optional().ui({ label: "Media", width: 33 }),
    connector: select(["sata", "sas", "nvme", "usb"]).optional().ui({ label: "Interface", width: 33 }),
    condition: select(CONDITIONS).optional().ui({ label: "Condition", width: 50 }),
    powerOnHours: integer().min(0).optional().ui({ label: "SMART power-on hours", width: 50 }),
    serial: text().max(80).optional().access({ read: "admin" }).ui({ label: "Inventory serial", width: 50 }),
  },
});

export const orders = order({ label: "WooCommerce orders" });

export const stockMovements = table({
  // Keep native record IDs in the audit trail even if Woo later retires a product or order.
  drive: integer().min(1).ui({ label: "Woo product ID" }),
  change: number().ui({ label: "Change" }),
  reason: select(["sale", "restock", "return"]).ui({ label: "Reason" }),
  order: integer().min(1).optional().ui({ label: "Woo order ID" }),
  at: timestamp().defaultNow().ui({ label: "When" }),
}, {
  label: "Stock movements",
  access: { read: "admin", create: false, update: false, delete: false },
  agents: false,
});

export const settings = global({
  notice: text({ multiline: true }).max(300).optional().ui({ label: "Notice banner" }),
  lowStockAt: integer().min(0).max(100).default(2).ui({ label: "Low stock at" }),
}, { label: "Storefront settings", access: { read: "anyone", update: "admin" } });
