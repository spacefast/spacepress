// adminScreen(): a TypedPress Admin screen declared in TypeScript (docs/admin-screens.md).
import { action, adminScreen, boolean, integer, item, number, text } from "typedpress";

const listPending = action({
  input: { limit: integer().optional() },
  readonly: true,
  handler: () => ({ rows: [{ id: 1, total: 3, shipped: false }] }),
});
const markShipped = action({ input: { id: integer(), note: text().optional() }, handler: ({ id }) => ({ id }) });
const rename = action({ input: { id: integer(), patch: text() }, handler: () => null });
const readOne = action({ input: { id: integer() }, readonly: true, handler: () => ({ total: 1 }) });
void number; void boolean;

export const pendingOrders = adminScreen({
  title: "Pending orders",
  description: "Orders waiting to ship.",
  access: "editor",
  view: {
    action: listPending,
    input: { limit: 50 },
    items: "rows",
    fields: { id: { label: "Order" }, total: { label: "Total", type: "number" }, shipped: { label: "Shipped", type: "boolean" } },
    layout: { type: "table", titleField: "id", fields: ["total", "shipped"], sort: { field: "total", direction: "desc" } },
  },
  actions: [
    { id: "ship", label: "Mark shipped", action: markShipped, input: { id: item("id") } },
    { id: "rename", label: "Rename", action: rename, input: { id: item("id"), patch: "x" }, confirm: "Sure?" },
  ],
  menu: { icon: "dashicons-cart" },
  classic: false,
});

export const orderForm = adminScreen({
  title: "Order",
  capability: "edit_others_posts",
  form: {
    action: readOne,
    input: { id: 1 },
    fields: { total: { label: "Total", type: "number" } },
    layout: { fields: ["total"] },
    submit: { id: "save", label: "Save", action: rename, input: { id: 1, patch: item("total") } },
  },
  menu: false,
});

adminScreen({
  title: "Bad layout",
  // @ts-expect-error `totl` is not a declared field
  view: { action: listPending, fields: { total: {} }, layout: { fields: ["totl"] } },
});

adminScreen({
  title: "Bad input",
  view: { action: listPending, fields: { id: {} } },
  // @ts-expect-error markShipped has no input `nope`
  actions: [{ id: "ship", label: "Ship", action: markShipped, input: { id: item("id"), nope: 1 } }],
});

adminScreen({
  title: "Bad field type",
  // @ts-expect-error `money` isn't a DataViews field type
  view: { action: listPending, fields: { total: { type: "money" } } },
});

// @ts-expect-error a screen has a view or a form, not both
adminScreen({ title: "Both", view: { action: listPending, fields: { id: {} } }, form: { action: readOne, fields: { id: {} } } });

// @ts-expect-error access and capability are exclusive
adminScreen({ title: "Both access", access: "editor", capability: "read", view: { action: listPending, fields: { id: {} } } });
