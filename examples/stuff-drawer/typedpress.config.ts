import {
  action, collection, date, db, defineConfig, HttpError,
  integer, job, jobs, json, media, table, text, timestamp,
  type InferSelectModel, select, ref,
} from "typedpress";
import { actorId, ownerId, personalAccess } from "./tp/lib/ownership";

export const bins = collection({
  name: text().min(1),
  location: text().min(1).ui({ help: "For example: hallway cupboard, top shelf." }),
  photo: media({ accept: "image" }).optional(),
  ownerId,
}, { title: "name", label: "Bins", access: personalAccess }).on({ beforeCreate(data, ctx) { data.ownerId = actorId(ctx); } });

export const things = collection({
  name: text().min(1),
  kind: select(["cable", "adapter", "charger", "tool", "book", "other"]).default("other"),
  connectorA: text().ui({ label: "Connector A", placeholder: "USB-C" }).optional(),
  connectorB: text().ui({ label: "Connector B", placeholder: "Lightning" }).optional(),
  lengthCm: integer().min(0).ui({ label: "Length in cm" }).optional(),
  wattage: integer().min(0).ui({ label: "Power in watts" }).optional(),
  binId: ref(bins).optional(),
  quantity: integer().min(1).default(1).ui({ help: "Total owned, including copies lent out. Each loan is one copy." }),
  photo: media({ accept: "image" }).optional(),
  tags: json<string[]>().$default(() => []).validate((tags) => (Array.isArray(tags) && tags.every((tag) => typeof tag === "string")) || "Tags must be a JSON list of strings.").ui({ help: 'A JSON list, for example ["travel", "iphone"].' }),
  ownerId,
}, { title: "name", label: "Things", access: personalAccess }).on({
  async beforeCreate(data, ctx) {
    data.ownerId = actorId(ctx);
    await checkBin(data.binId, actorId(ctx));
  },
  async beforeUpdate(patch, existing) {
    await checkBin(patch.binId === undefined ? existing.binId : patch.binId, existing.ownerId);
    const quantity = patch.quantity;
    if (quantity !== undefined) {
      const active = await db.query.loans.findMany({ where: {
        ownerId: existing.ownerId, thingId: existing.id, returnedOn: { isNull: true },
      } });
      if (quantity < active.length) throw new HttpError(409, "copies_on_loan", "Return copies before reducing the quantity.");
    }
  },
});

export const people = collection({
  name: text().min(1),
  contact: text().ui({ help: "Email, phone number, or another way to reach them." }).optional(),
  ownerId,
}, { title: "name", label: "People", access: personalAccess }).on({ beforeCreate(data, ctx) { data.ownerId = actorId(ctx); } });

export const loans = table({
  thingId: ref(things),
  personId: ref(people),
  lentOn: date().defaultNow(),
  dueOn: date(),
  returnedOn: date().optional(),
  overdueAt: timestamp().access({ create: false, update: false }).ui({ help: "First overdue check by Action Scheduler. Kept after return as history." }).optional(),
  ownerId,
}, { label: "Lending log", access: personalAccess }).on({
  async beforeCreate(data, ctx) {
    data.ownerId = actorId(ctx);
    await checkLoan({
      ownerId: data.ownerId, thingId: data.thingId, personId: data.personId, dueOn: data.dueOn,
      lentOn: data.lentOn ?? new Date().toISOString().slice(0, 10), returnedOn: data.returnedOn,
    });
  },
  async beforeUpdate(patch, existing) {
    await checkLoan({
      id: existing.id, ownerId: existing.ownerId,
      thingId: patch.thingId ?? existing.thingId, personId: patch.personId ?? existing.personId,
      lentOn: patch.lentOn ?? existing.lentOn, dueOn: patch.dueOn ?? existing.dueOn,
      returnedOn: patch.returnedOn === undefined ? existing.returnedOn : patch.returnedOn,
    });
  },
  afterCreate: scheduleOverdue,
  afterUpdate: scheduleOverdue,
});

const collections = { bins, things, people };
const tables = { loans };

type Loan = InferSelectModel<typeof loans>;

async function checkBin(binId: number | null | undefined, owner: number) {
  if (binId == null) return;
  const bin = await db.query.bins.findFirst({ where: { id: binId, ownerId: owner } });
  if (!bin) throw new HttpError(404, "not_found", "Bin not found in your drawer.");
}

async function checkLoan(loan: {
  id?: number; ownerId: number; thingId: number; personId: number;
  lentOn: string; dueOn: string; returnedOn?: string | null;
}) {
  const thing = await db.query.things.findFirst({ where: { id: loan.thingId, ownerId: loan.ownerId } });
  const person = await db.query.people.findFirst({ where: { id: loan.personId, ownerId: loan.ownerId } });
  if (!thing || !person) throw new HttpError(404, "not_found", "Thing or person not found in your drawer.");
  if (loan.dueOn < loan.lentOn || (loan.returnedOn != null && loan.returnedOn < loan.lentOn)) {
    throw new HttpError(422, "invalid_input", "Due and return dates cannot precede the lending date.");
  }
  if (loan.returnedOn == null) {
    const active = await db.query.loans.findMany({ where: {
      ownerId: loan.ownerId, thingId: loan.thingId, returnedOn: { isNull: true },
    } });
    const otherLoans = active.filter((entry) => entry.id !== loan.id);
    if (otherLoans.length >= thing.quantity) throw new HttpError(409, "all_lent", "Every copy is already on loan.");
  }
}

async function scheduleOverdue(loan: Loan) {
  if (loan.returnedOn != null || loan.overdueAt != null) return;
  const deadline = new Date(`${loan.dueOn}T00:00:00.000Z`).getTime() + 86_400_000;
  await jobs.markOverdue.enqueue({ loanId: loan.id, ownerId: loan.ownerId }, {
    delay: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
    key: `loan-${loan.id}-${loan.dueOn}`,
  });
}

async function describeLoans(owner: number, entries: Loan[]) {
  const result = [];
  for (const loan of entries) {
    const thing = await db.query.things.findFirst({ where: { id: loan.thingId, ownerId: owner } });
    const person = await db.query.people.findFirst({ where: { id: loan.personId, ownerId: owner } });
    result.push({ loan, thing, person });
  }
  return result;
}

export const markOverdue = job({
  input: { loanId: integer(), ownerId: integer() },
  retries: 3,
  async handler({ loanId, ownerId }) {
    const today = new Date().toISOString().slice(0, 10);
    await db.update(loans).set({ overdueAt: new Date().toISOString() }).where({
      id: loanId, ownerId, dueOn: { lt: today },
      returnedOn: { isNull: true }, overdueAt: { isNull: true },
    });
  },
});

export const find = action({
  input: { query: text().min(1) }, access: "authenticated",
  async handler({ query }, ctx) {
    const owner = actorId(ctx);
    const words = query.toLowerCase().trim().split(/\s+/);
    const inventory = await db.query.things.findMany({ where: { ownerId: owner }, orderBy: { name: "asc" } });
    const result = [];
    for (const thing of inventory) {
      const searchable = `${thing.name} ${thing.connectorA ?? ""} ${thing.connectorB ?? ""} ${thing.tags.join(" ")}`.toLowerCase();
      if (!words.every((word) => word === undefined || searchable.includes(word))) continue;
      const bin = thing.binId == null ? null : await db.query.bins.findFirst({ where: { id: thing.binId, ownerId: owner } });
      const active = await db.query.loans.findMany({ where: { thingId: thing.id, ownerId: owner, returnedOn: { isNull: true } } });
      result.push({ thing, bin, outOnLoan: active.length > 0, availableQuantity: thing.quantity - active.length });
    }
    return result;
  },
});

export const lend = action({
  input: { thingId: integer(), personId: integer(), dueOn: date(), lentOn: date().defaultNow() },
  access: "authenticated", idempotent: true,
  async handler(input, ctx) {
    const [loan] = await db.insert(loans).values({ ...input, ownerId: actorId(ctx) }).returning();
    return loan;
  },
});

export const giveBack = action({
  input: { loanId: integer(), returnedOn: date().defaultNow() }, access: "authenticated",
  async handler({ loanId, returnedOn }, ctx) {
    const owner = actorId(ctx);
    const loan = await db.query.loans.findFirst({ where: { id: loanId, ownerId: owner } });
    if (!loan) throw new HttpError(404, "not_found", "Loan not found in your drawer.");
    if (loan.returnedOn != null) return loan;
    const [updated] = await db.update(loans).set({ returnedOn }).where({ id: loanId, ownerId: owner }).returning();
    return updated;
  },
});

export const overdue = action({
  input: {}, access: "authenticated",
  async handler(input, ctx) {
    const owner = actorId(ctx);
    const entries = await db.query.loans.findMany({ where: {
      ownerId: owner, returnedOn: { isNull: true }, dueOn: { lt: new Date().toISOString().slice(0, 10) },
    }, orderBy: { dueOn: "asc" } });
    return await describeLoans(owner, entries);
  },
});

export const whoHas = action({
  input: { personId: integer() }, access: "authenticated",
  async handler({ personId }, ctx) {
    const owner = actorId(ctx);
    const person = await db.query.people.findFirst({ where: { id: personId, ownerId: owner } });
    if (!person) throw new HttpError(404, "not_found", "Person not found in your drawer.");
    const entries = await db.query.loans.findMany({ where: { ownerId: owner, personId, returnedOn: { isNull: true } }, orderBy: { lentOn: "asc" } });
    return await describeLoans(owner, entries);
  },
});

export default defineConfig({
  name: "stuff-drawer",
});
