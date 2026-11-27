import { global, table, f } from "spacepress";
import { order, product, productCategory, productTag, store } from "spacepress/commerce";

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
  sync: "content/drives/*.md",
  inventory: true,
  reviews: true,
  fields: {
    brand: f.text().max(60).optional().ui({ label: "Brand", width: 50 }),
    model: f.text().max(80).optional().ui({ label: "Model", width: 50 }),
    capacityGb: f.integer().min(1).max(100_000).optional().ui({ label: "Capacity (GB)", width: 33 }),
    media: f.select(MEDIA).optional().ui({ label: "Media", width: 33 }),
    connector: f.select(["sata", "sas", "nvme", "usb"]).optional().ui({ label: "Interface", width: 33 }),
    condition: f.select(CONDITIONS).optional().ui({ label: "Condition", width: 50 }),
    powerOnHours: f.integer().min(0).optional().ui({ label: "SMART power-on hours", width: 50 }),
    testedOn: f.date().optional().ui({ label: "Tested on", width: 50 }),
    serial: f.text().max(80).optional().access({ read: "admin" }).ui({ label: "Inventory serial", width: 50 }),
  },
});

// Woo's own product categories and tags, seeded from Markdown like the drives.
export const categories = productCategory({ label: "Drive categories", sync: "content/drive-categories/*.md" });
export const tags = productTag({ label: "Drive tags", sync: "content/drive-tags/*.md" });

export const orders = order({ label: "WooCommerce orders" });

export const stockMovements = table({
  // Keep native record IDs in the audit trail even if Woo later retires a product or order.
  drive: f.integer().min(1).ui({ label: "Woo product ID" }),
  change: f.number().ui({ label: "Change" }),
  reason: f.select(["sale", "restock", "return"]).ui({ label: "Reason" }),
  order: f.integer().min(1).optional().ui({ label: "Woo order ID" }),
  at: f.timestamp().defaultNow().ui({ label: "When" }),
}, {
  label: "Stock movements",
  access: { read: "admin", create: false, update: false, delete: false },
  agents: false,
});

export const settings = global({
  notice: f.text({ multiline: true }).max(300).optional().ui({ label: "Notice banner" }),
  lowStockAt: f.integer().min(0).max(100).default(2).ui({ label: "Low stock at" }),
}, { label: "Storefront settings", access: { read: "anyone", update: "admin" } });
