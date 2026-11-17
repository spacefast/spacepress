// What the shop sells and what it has sold.
//
// - `drives` is a collection: WordPress posts an editor writes and publishes, with a name and a
//   description, its specs, price and stock, reviews (`comments`) and a page at /drives/<slug>.
// - `orders` and `stockMovements` are SQL tables: rows the app writes, filters and counts.
// - `shop` is a global: one record of settings, stored as WordPress options.
//
// The hooks are the shop's rules, so they hold on every path into the data: the storefront's
// forms, the API, TypedPress Admin and wp-admin.
import {
  collection, db, email, global, HttpError, integer, number, ref, richText, select, slug, table,
  text, timestamp,
} from "typedpress";

export const MEDIA = ["hdd", "ssd", "nvme"] as const;
export const CONDITIONS = ["like-new", "good", "fair", "for-parts"] as const;

export const drives = collection({
  name: text().min(1).max(120).ui({ label: "Name", help: "Shown on the storefront." }),
  slug: slug({ source: "name" }).optional(),
  summary: text().max(200).optional().ui({ label: "Summary", help: "One line for the catalog card." }),
  description: richText().optional(),
  brand: text().min(1).max(60).ui({ label: "Brand", width: 50 }),
  model: text().min(1).max(80).ui({ label: "Model", width: 50 }),
  capacityGb: integer().min(1).max(100_000).ui({ label: "Capacity (GB)", width: 33 }),
  media: select(MEDIA).default("hdd").ui({ label: "Media", width: 33 }),
  connector: select(["sata", "sas", "nvme", "usb"]).default("sata").ui({ label: "Interface", width: 33 }),
  condition: select(CONDITIONS).default("good").ui({ label: "Condition", width: 50 }),
  powerOnHours: integer().min(0).optional().ui({ label: "Power-on hours", help: "From the drive's SMART data.", width: 50 }),
  price: number().min(0.01).max(100_000).ui({ label: "Price", help: "In the shop's currency, two decimals at most.", width: 50 }),
  stock: integer().min(0).max(10_000).default(0).ui({ label: "In stock", width: 50 }),
}, {
  label: "Drives",
  title: "name",
  content: "description",
  url: "/drives/:slug",
  // Customer reviews: signed-in customers only, a first review is held for moderation.
  comments: true,
  // The storefront's starting stock, as Markdown: `typedpress sync` loads it into a dev site, and a
  // publish seeds it.
  sync: "content/drives/*.md",
  access: { read: "anyone", create: "editor", update: "editor", delete: "admin" },
}).on({
  beforeCreate(data) {
    if (data.price !== undefined) checkPrice(data.price);
    if (data.brand !== undefined) data.brand = data.brand.trim();
    if (data.model !== undefined) data.model = data.model.trim();
  },
  beforeUpdate(patch) {
    if (patch.price !== undefined) checkPrice(patch.price);
  },
});

export const orders = table({
  code: text().max(16).unique().ui({ label: "Order code" }),
  drive: ref(drives).ui({ label: "Drive" }),
  quantity: integer().min(1).max(5).default(1).ui({ label: "Quantity" }),
  // Filled by the beforeCreate hook from the drive, never by the buyer.
  unitPrice: number().default(0).access({ create: false, update: false }).ui({ label: "Unit price" }),
  total: number().default(0).access({ create: false, update: false }).ui({ label: "Total" }),
  buyerName: text().min(1).max(80).ui({ label: "Buyer" }),
  buyerEmail: email().max(191).ui({ label: "Email" }),
  // The WordPress user who bought it; 0 for a guest.
  buyerId: integer().default(0).access({ create: false, update: false }).ui({ label: "Buyer user ID" }),
  status: select(["placed", "shipped", "cancelled"]).default("placed").ui({ label: "Status" }),
  placedAt: timestamp().defaultNow().ui({ label: "Placed" }),
  shippedAt: timestamp().optional().ui({ label: "Shipped" }),
}, {
  label: "Orders",
  access: {
    // Staff see every order; a customer sees their own; a guest sees none.
    read: (ctx) => isStaff(ctx.user?.role) ? true : ctx.user ? { buyerId: ctx.user.id } : false,
    create: "editor",
    update: "editor",
    delete: "admin",
  },
}).on({
  // The one place an order's price and stock are checked, whoever creates it.
  async beforeCreate(data) {
    const drive = await db.query.drives.findFirst({ where: { id: data.drive } });
    if (!drive || drive.status !== "published") throw new HttpError(404, "not_found", "That drive isn't for sale.");
    const quantity = data.quantity ?? 1;
    if (drive.stock < quantity) {
      throw new HttpError(409, "out_of_stock", drive.stock === 0 ? "Sold out." : `Only ${drive.stock} left.`);
    }
    data.quantity = quantity;
    data.unitPrice = drive.price;
    data.total = Math.round(drive.price * quantity * 100) / 100;
    data.buyerName = data.buyerName.trim();
  },
  // Selling takes the drives off the shelf, and the movement log says why.
  async afterCreate(order) {
    const drive = await db.query.drives.findFirst({ where: { id: order.drive } });
    if (!drive) return;
    await db.update(drives).set({ stock: drive.stock - order.quantity }).where({ id: drive.id });
    await db.insert(stockMovements).values({ drive: drive.id, change: -order.quantity, reason: "sale", order: order.id });
  },
});

export const stockMovements = table({
  drive: ref(drives).onDelete("cascade").ui({ label: "Drive" }),
  change: integer().ui({ label: "Change" }),
  reason: select(["sale", "restock", "return"]).ui({ label: "Reason" }),
  order: ref(orders).optional().ui({ label: "Order" }),
  note: text().max(200).optional().ui({ label: "Note" }),
  at: timestamp().defaultNow().ui({ label: "When" }),
}, {
  label: "Stock movements",
  access: { read: "editor", create: "admin", update: "admin", delete: "admin" },
});

export const shop = global({
  shopName: text().min(1).max(60).default("Drive Store").ui({ label: "Shop name" }),
  currency: select(["USD", "EUR", "TRY"]).default("USD").ui({ label: "Currency" }),
  notice: text({ multiline: true }).max(300).optional().ui({ label: "Notice banner", help: "Shown above every storefront page while set." }),
  lowStockAt: integer().min(0).max(100).default(2).ui({ label: "Low stock at", help: "The staff page flags drives with this many or fewer left." }),
}, { label: "Shop settings", access: { read: "anyone", update: "admin" } });

export function isStaff(role: string | undefined): boolean {
  return role === "editor" || role === "admin";
}

function checkPrice(price: number) {
  if (Math.round(price * 100) / 100 !== price) {
    throw new HttpError(422, "invalid_input", "A price has two decimals at most.");
  }
}
