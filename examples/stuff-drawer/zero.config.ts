import {
  action, collection, date, db, defineConfig, defineRelations, HttpError,
  integer, job, jobs, json, media, table, text, timestamp,
  type InferSelectModel,
} from "zero";
import { actorId, ownerId, personalAccess } from "./lib/ownership";

const bins = collection({
  name: text().notNull().min(1),
  location: text().notNull().min(1).ui({ help: "For example: hallway cupboard, top shelf." }),
  photo: media({ accept: "image" }),
  ownerId,
}, { title: "name", label: "Bins", access: personalAccess });

const things = collection({
  name: text().notNull().min(1),
  kind: text({ enum: ["cable", "adapter", "charger", "tool", "book", "other"] }).notNull().default("other"),
  connectorA: text().ui({ label: "Connector A", placeholder: "USB-C" }),
  connectorB: text().ui({ label: "Connector B", placeholder: "Lightning" }),
  lengthCm: integer().min(0).ui({ label: "Length in cm" }),
  wattage: integer().min(0).ui({ label: "Power in watts" }),
  binId: integer().references(() => bins.id, { onDelete: "set null" }),
  quantity: integer().notNull().min(1).default(1).ui({ help: "Total owned, including copies lent out. Each loan is one copy." }),
  photo: media({ accept: "image" }),
  tags: json().$type<string[]>().notNull().$default(() => [])
    .validate((tags) => (Array.isArray(tags) && tags.every((tag) => typeof tag === "string")) || "Tags must be a JSON list of strings.")
    .ui({ help: 'A JSON list, for example ["travel", "iphone"].' }),
  ownerId,
}, { title: "name", label: "Things", access: personalAccess });

const people = collection({
  name: text().notNull().min(1),
  contact: text().ui({ help: "Email, phone number, or another way to reach them." }),
  ownerId,
}, { title: "name", label: "People", access: personalAccess });

const loans = table({
  thingId: integer().notNull().references(() => things.id, { onDelete: "restrict" }),
  personId: integer().notNull().references(() => people.id, { onDelete: "restrict" }),
  lentOn: date().notNull().defaultNow(),
  dueOn: date().notNull(),
  returnedOn: date(),
  overdueAt: timestamp().access({ create: false, update: false })
    .ui({ help: "First overdue check by Action Scheduler. Kept after return as history." }),
  ownerId,
}, { label: "Lending log", access: personalAccess });

const collections = { bins, things, people };
const tables = { loans };
const relations = defineRelations({ ...collections, ...tables }, (r) => ({
  things: { bin: r.one.bins({ from: r.things.binId, to: r.bins.id }), loans: r.many.loans() },
  bins: { things: r.many.things() },
  people: { loans: r.many.loans() },
  loans: {
    thing: r.one.things({ from: r.loans.thingId, to: r.things.id }),
    person: r.one.people({ from: r.loans.personId, to: r.people.id }),
  },
}));

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

export default defineConfig({
  name: "stuff-drawer",
  admin: true,
  collections, tables, relations,
  hooks: {
    bins: { beforeCreate(data, ctx) { data.ownerId = actorId(ctx); } },
    people: { beforeCreate(data, ctx) { data.ownerId = actorId(ctx); } },
    things: {
      async beforeCreate(data, ctx) {
        data.ownerId = actorId(ctx);
        await checkBin(data.binId, actorId(ctx));
      },
      async beforeUpdate(patch, existing) {
        await checkBin(patch.binId === undefined ? existing.binId : patch.binId, existing.ownerId);
        if (patch.quantity !== undefined) {
          const active = await db.query.loans.findMany({ where: {
            ownerId: existing.ownerId, thingId: existing.id, returnedOn: { isNull: true },
          } });
          if (patch.quantity < active.length) throw new HttpError(409, "copies_on_loan", "Return copies before reducing the quantity.");
        }
      },
    },
    loans: {
      async beforeCreate(data, ctx) {
        data.ownerId = actorId(ctx);
        await checkLoan({ ...data, ownerId: actorId(ctx), lentOn: data.lentOn ?? new Date().toISOString().slice(0, 10) });
      },
      async beforeUpdate(patch, existing) {
        await checkLoan({ ...existing, ...patch });
      },
      afterCreate: scheduleOverdue,
      afterUpdate: scheduleOverdue,
    },
  },
  jobs: {
    markOverdue: job({
      input: { loanId: integer().notNull(), ownerId: integer().notNull() },
      retries: 3,
      async handler({ loanId, ownerId }) {
        const today = new Date().toISOString().slice(0, 10);
        await db.update(loans).set({ overdueAt: new Date().toISOString() }).where({
          id: loanId, ownerId, dueOn: { lt: today },
          returnedOn: { isNull: true }, overdueAt: { isNull: true },
        });
      },
    }),
  },
  actions: {
    find: action({
      input: { query: text().notNull().min(1) }, access: "authenticated",
      async handler({ query }, ctx) {
        const owner = actorId(ctx);
        const words = query.toLowerCase().trim().split(/\s+/);
        const inventory = await db.query.things.findMany({ where: { ownerId: owner }, orderBy: { name: "asc" } });
        const result = [];
        for (const thing of inventory) {
          const searchable = `${thing.name} ${thing.connectorA ?? ""} ${thing.connectorB ?? ""} ${thing.tags.join(" ")}`.toLowerCase();
          if (!words.every((word) => searchable.includes(word))) continue;
          const bin = thing.binId == null ? null : await db.query.bins.findFirst({ where: { id: thing.binId, ownerId: owner } });
          const active = await db.query.loans.findMany({ where: { thingId: thing.id, ownerId: owner, returnedOn: { isNull: true } } });
          result.push({ thing, bin, outOnLoan: active.length > 0, availableQuantity: thing.quantity - active.length });
        }
        return result;
      },
    }),
    lend: action({
      input: { thingId: integer().notNull(), personId: integer().notNull(), dueOn: date().notNull(), lentOn: date().notNull().defaultNow() },
      access: "authenticated", idempotent: true,
      async handler(input, ctx) {
        const [loan] = await db.insert(loans).values({ ...input, ownerId: actorId(ctx) }).returning();
        return loan;
      },
    }),
    giveBack: action({
      input: { loanId: integer().notNull(), returnedOn: date().notNull().defaultNow() }, access: "authenticated",
      async handler({ loanId, returnedOn }, ctx) {
        const owner = actorId(ctx);
        const loan = await db.query.loans.findFirst({ where: { id: loanId, ownerId: owner } });
        if (!loan) throw new HttpError(404, "not_found", "Loan not found in your drawer.");
        if (loan.returnedOn != null) return loan;
        const [updated] = await db.update(loans).set({ returnedOn }).where({ id: loanId, ownerId: owner }).returning();
        return updated;
      },
    }),
    overdue: action({
      input: {}, access: "authenticated",
      async handler(input, ctx) {
        const owner = actorId(ctx);
        const entries = await db.query.loans.findMany({ where: {
          ownerId: owner, returnedOn: { isNull: true }, dueOn: { lt: new Date().toISOString().slice(0, 10) },
        }, orderBy: { dueOn: "asc" } });
        return describeLoans(owner, entries);
      },
    }),
    whoHas: action({
      input: { personId: integer().notNull() }, access: "authenticated",
      async handler({ personId }, ctx) {
        const owner = actorId(ctx);
        const person = await db.query.people.findFirst({ where: { id: personId, ownerId: owner } });
        if (!person) throw new HttpError(404, "not_found", "Person not found in your drawer.");
        const entries = await db.query.loans.findMany({ where: { ownerId: owner, personId, returnedOn: { isNull: true } }, orderBy: { lentOn: "asc" } });
        return describeLoans(owner, entries);
      },
    }),
  },
});
