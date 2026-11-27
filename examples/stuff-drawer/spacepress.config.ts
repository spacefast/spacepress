import { collection, defineConfig, f, job, mutation, query, table, type InferSelectModel } from "spacepress";
import { db, HttpError } from "spacepress/server";
import { actorId, ownerId, personalAccess } from "./sp/lib/ownership";

export const bins = collection({
  name: f.text().min(1),
  location: f.text().min(1).ui({ help: "For example: hallway cupboard, top shelf." }),
  photo: f.media({ accept: "image" }).optional(),
  ownerId,
}, { title: "name", label: "Bins", access: personalAccess }).on({ beforeCreate({ data, user }) { data.ownerId = actorId({ user }); } });

export const things = collection({
  name: f.text().min(1),
  kind: f.select(["cable", "adapter", "charger", "tool", "book", "other"]).default("other"),
  connectorA: f.text().ui({ label: "Connector A", placeholder: "USB-C" }).optional(),
  connectorB: f.text().ui({ label: "Connector B", placeholder: "Lightning" }).optional(),
  lengthCm: f.integer().min(0).ui({ label: "Length in cm" }).optional(),
  wattage: f.integer().min(0).ui({ label: "Power in watts" }).optional(),
  binId: f.ref(bins).optional(),
  quantity: f.integer().min(1).default(1).ui({ help: "Total owned, including copies lent out. Each loan is one copy." }),
  photo: f.media({ accept: "image" }).optional(),
  tags: f.json<string[]>().default(() => []).validate((tags) => (Array.isArray(tags) && tags.every((tag) => typeof tag === "string")) || "Tags must be a JSON list of strings.").ui({ help: 'A JSON list, for example ["travel", "iphone"].' }),
  ownerId,
}, { title: "name", label: "Things", access: personalAccess }).on({
  async beforeCreate({ data, user }) {
    const owner = actorId({ user });
    data.ownerId = owner;
    await checkBin(data.binId, owner);
  },
  async beforeUpdate({ patch, existing, db }) {
    await checkBin(patch.binId === undefined ? existing.binId : patch.binId, existing.ownerId);
    const quantity = patch.quantity;
    if (quantity !== undefined) {
      const active = await db.system.loans.list({ where: {
        ownerId: existing.ownerId, thingId: existing.id, returnedOn: { isNull: true },
      } });
      if (quantity < active.length) throw new HttpError(409, "copies_on_loan", "Return copies before reducing the quantity.");
    }
  },
});

export const people = collection({
  name: f.text().min(1),
  contact: f.text().ui({ help: "Email, phone number, or another way to reach them." }).optional(),
  ownerId,
}, { title: "name", label: "People", access: personalAccess }).on({ beforeCreate({ data, user }) { data.ownerId = actorId({ user }); } });

export const loans = table({
  thingId: f.ref(things),
  personId: f.ref(people),
  lentOn: f.date().defaultNow(),
  dueOn: f.date(),
  returnedOn: f.date().optional(),
  overdueAt: f.timestamp().access({ create: false, update: false }).ui({ help: "First overdue check by Action Scheduler. Kept after return as history." }).optional(),
  ownerId,
}, { label: "Lending log", access: personalAccess }).on({
  async beforeCreate({ data, user }) {
    data.ownerId = actorId({ user });
    await checkLoan({
      ownerId: data.ownerId, thingId: data.thingId, personId: data.personId, dueOn: data.dueOn,
      lentOn: data.lentOn ?? new Date().toISOString().slice(0, 10), returnedOn: data.returnedOn,
    });
  },
  async beforeUpdate({ patch, existing }) {
    await checkLoan({
      id: existing.id, ownerId: existing.ownerId,
      thingId: patch.thingId ?? existing.thingId, personId: patch.personId ?? existing.personId,
      lentOn: patch.lentOn ?? existing.lentOn, dueOn: patch.dueOn ?? existing.dueOn,
      returnedOn: patch.returnedOn === undefined ? existing.returnedOn : patch.returnedOn,
    });
  },
  async afterCreate({ row }) { await scheduleOverdue(row); },
  async afterUpdate({ row }) { await scheduleOverdue(row); },
});

const collections = { bins, things, people };
const tables = { loans };
void [collections, tables];

type Loan = InferSelectModel<typeof loans>;

async function checkBin(binId: number | null | undefined, owner: number) {
  if (binId == null) return;
  const bin = await db.system.bins.get({ id: binId, ownerId: owner });
  if (!bin) throw new HttpError(404, "not_found", "Bin not found in your drawer.");
}

async function checkLoan(loan: {
  id?: number; ownerId: number; thingId: number; personId: number;
  lentOn: string; dueOn: string; returnedOn?: string | null;
}) {
  const thing = await db.system.things.get({ id: loan.thingId, ownerId: loan.ownerId });
  const person = await db.system.people.get({ id: loan.personId, ownerId: loan.ownerId });
  if (!thing || !person) throw new HttpError(404, "not_found", "Thing or person not found in your drawer.");
  if (loan.dueOn < loan.lentOn || (loan.returnedOn != null && loan.returnedOn < loan.lentOn)) {
    throw new HttpError(422, "invalid_input", "Due and return dates cannot precede the lending date.");
  }
  if (loan.returnedOn == null) {
    const active = await db.system.loans.list({ where: {
      ownerId: loan.ownerId, thingId: loan.thingId, returnedOn: { isNull: true },
    } });
    const otherLoans = active.filter((entry) => entry.id !== loan.id);
    if (otherLoans.length >= thing.quantity) throw new HttpError(409, "all_lent", "Every copy is already on loan.");
  }
}

async function scheduleOverdue(loan: Loan) {
  if (loan.returnedOn != null || loan.overdueAt != null) return;
  const deadline = new Date(`${loan.dueOn}T00:00:00.000Z`).getTime() + 86_400_000;
  await markOverdue.enqueue({ loanId: loan.id, ownerId: loan.ownerId }, {
    delay: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
    key: `loan-${loan.id}-${loan.dueOn}`,
  });
}

async function describeLoans(owner: number, entries: Loan[]) {
  const result = [];
  for (const loan of entries) {
    const thing = await db.system.things.get({ id: loan.thingId, ownerId: owner });
    const person = await db.system.people.get({ id: loan.personId, ownerId: owner });
    result.push({ loan, thing, person });
  }
  return result;
}

export const markOverdue = job({ retries: 3 }, async ({ db }, { loanId, ownerId }: { loanId: number; ownerId: number }) => {
  if (!Number.isInteger(loanId)) throw new HttpError(422, "invalid_input", "loanId must be an integer", "/loanId");
  if (!Number.isInteger(ownerId)) throw new HttpError(422, "invalid_input", "ownerId must be an integer", "/ownerId");
  const today = new Date().toISOString().slice(0, 10);
  const loan = await db.loans.get({
    id: loanId, ownerId, dueOn: { lt: today },
    returnedOn: { isNull: true }, overdueAt: { isNull: true },
  });
  if (loan) await db.loans.update(loan.id, { overdueAt: new Date().toISOString() });
});

export const find = query({ access: "authenticated" }, async ({ db, user }, { query }: { query: string }) => {
  if (query.length < 1) throw new HttpError(422, "invalid_input", "query must be at least 1 character", "/query");
  const owner = actorId({ user });
  const words = query.toLowerCase().trim().split(/\s+/);
  const inventory = await db.things.list({ where: { ownerId: owner }, orderBy: { name: "asc" } });
  const result = [];
  for (const thing of inventory) {
    const searchable = `${thing.name} ${thing.connectorA ?? ""} ${thing.connectorB ?? ""} ${thing.tags.join(" ")}`.toLowerCase();
    if (!words.every((word) => word === undefined || searchable.includes(word))) continue;
    const bin = thing.binId == null ? null : await db.bins.get({ id: thing.binId, ownerId: owner });
    const active = await db.loans.list({ where: { thingId: thing.id, ownerId: owner, returnedOn: { isNull: true } } });
    result.push({ thing, bin, outOnLoan: active.length > 0, availableQuantity: thing.quantity - active.length });
  }
  return result;
});

export const lend = mutation({ access: "authenticated", idempotent: true }, async ({ db, user }, input: { thingId: number; personId: number; dueOn: string; lentOn?: string }) => {
  if (!Number.isInteger(input.thingId)) throw new HttpError(422, "invalid_input", "thingId must be an integer", "/thingId");
  if (!Number.isInteger(input.personId)) throw new HttpError(422, "invalid_input", "personId must be an integer", "/personId");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) throw new HttpError(422, "invalid_input", "dueOn must be a date (YYYY-MM-DD)", "/dueOn");
  if (input.lentOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.lentOn)) throw new HttpError(422, "invalid_input", "lentOn must be a date (YYYY-MM-DD)", "/lentOn");
  return await db.system.loans.create({ ...input, ownerId: actorId({ user }) });
});

export const giveBack = mutation({ access: "authenticated" }, async ({ db, user }, { loanId, returnedOn = new Date().toISOString().slice(0, 10) }: { loanId: number; returnedOn?: string }) => {
  if (!Number.isInteger(loanId)) throw new HttpError(422, "invalid_input", "loanId must be an integer", "/loanId");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(returnedOn)) throw new HttpError(422, "invalid_input", "returnedOn must be a date (YYYY-MM-DD)", "/returnedOn");
  const owner = actorId({ user });
  const loan = await db.system.loans.get({ id: loanId, ownerId: owner });
  if (!loan) throw new HttpError(404, "not_found", "Loan not found in your drawer.");
  if (loan.returnedOn != null) return loan;
  return await db.system.loans.update(loanId, { returnedOn });
});

export const overdue = query({ access: "authenticated" }, async ({ db, user }) => {
  const owner = actorId({ user });
  const entries = await db.loans.list({ where: {
    ownerId: owner, returnedOn: { isNull: true }, dueOn: { lt: new Date().toISOString().slice(0, 10) },
  }, orderBy: { dueOn: "asc" } });
  return await describeLoans(owner, entries);
});

export const whoHas = query({ access: "authenticated" }, async ({ db, user }, { personId }: { personId: number }) => {
  if (!Number.isInteger(personId)) throw new HttpError(422, "invalid_input", "personId must be an integer", "/personId");
  const owner = actorId({ user });
  const person = await db.people.get({ id: personId, ownerId: owner });
  if (!person) throw new HttpError(404, "not_found", "Person not found in your drawer.");
  const entries = await db.loans.list({ where: { ownerId: owner, personId, returnedOn: { isNull: true } }, orderBy: { lentOn: "asc" } });
  return await describeLoans(owner, entries);
});

export default defineConfig({
  name: "stuff-drawer",
});
