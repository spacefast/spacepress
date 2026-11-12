import {
  action, date, db, defineConfig, defineRelations, email, HttpError,
  integer, job, jobs, json, table, text, timestamp, userProjection, type AccessConfig, number, select,
} from "first";
import { HEALTH } from "./first/lib/health";

const access = {
  read: ({ user }) => user ? { ownerId: user.id } : false,
  create: ({ user }) => user !== null,
  update: ({ user }) => user ? { ownerId: user.id } : false,
  delete: ({ user }) => user ? { ownerId: user.id } : false,
} satisfies AccessConfig;
const ownerId = integer().default(0).access({ create: false, update: false });

export const places = table({
  ownerId,
  name: text().min(1).max(120),
  kind: select(["nas-bay", "desktop", "laptop", "drawer", "offsite"]),
}, { access });

export const drives = table({
  ownerId,
  label: text().min(1).max(120),
  model: text().min(1).max(160),
  serial: text().min(1).max(160),
  serialKey: text().max(191).unique().default("").access({ read: false, create: false, update: false }),
  kind: select(["ssd", "hdd", "nvme", "sd", "usb"]),
  capacityGb: number().min(0.001),
  interface: text().min(1).max(80),
  purchasedOn: date().optional(),
  warrantyUntil: date().optional(),
  placeId: integer().references(() => places.id, { onDelete: "set null" }).optional(),
  status: select(["in-use", "spare", "failed", "retired"]).default("spare"),
  notes: text({ multiline: true }).optional(),
  tags: json<string[]>().$default(() => []),
  replacementNeededAt: timestamp().access({ create: false, update: false }).optional(),
}, { access });

export const healthReadings = table({
  ownerId,
  driveId: integer().references(() => drives.id, { onDelete: "cascade" }),
  readOn: date(),
  powerOnHours: integer().min(0),
  wearPercent: number().min(0).max(100),
  reallocatedSectors: integer().min(0),
  tempC: number().min(-40).max(150),
}, { access });

export const contents = table({
  ownerId,
  driveId: integer().references(() => drives.id, { onDelete: "cascade" }),
  description: text().min(1).max(500),
  usedGb: number().min(0),
  lastBackupOn: date().optional(),
}, { access });

const members = userProjection({
  email: email().unique().max(191),
  name: text(),
}, { access: { read: "self", create: false, update: "self", delete: false } });

const tables = { drives, places, healthReadings, contents };
const relations = defineRelations({ ...tables, members }, (r) => ({
  drives: {
    place: r.one.places({ from: r.drives.placeId, to: r.places.id }),
    healthReadings: r.many.healthReadings(),
    contents: r.many.contents(),
  },
  places: { drives: r.many.drives() },
  healthReadings: { drive: r.one.drives({ from: r.healthReadings.driveId, to: r.drives.id }) },
  contents: { drive: r.one.drives({ from: r.contents.driveId, to: r.drives.id }) },
}));

function actor(id: number | undefined): number {
  if (id === undefined) throw new HttpError(401, "unauthenticated", "Sign in to your drive locker.");
  return id;
}

async function requireDrive(driveId: number, owner: number) {
  const drive = await db.query.drives.findFirst({ where: { id: driveId, ownerId: owner } });
  if (!drive) throw new HttpError(404, "not_found", "Drive not found.");
  return drive;
}

async function checkPlace(placeId: number | null | undefined, owner: number) {
  if (placeId == null) return;
  const place = await db.query.places.findFirst({ where: { id: placeId, ownerId: owner } });
  if (!place) throw new HttpError(404, "not_found", "Place not found.");
}

async function checkUsage(driveId: number, owner: number, usedGb: number, exceptId: number) {
  const drive = await requireDrive(driveId, owner);
  const entries = await db.query.contents.findMany({ where: { driveId, ownerId: owner } });
  const used = entries.filter((entry) => entry.id !== exceptId).reduce((sum, entry) => sum + entry.usedGb, usedGb);
  if (used > drive.capacityGb) throw new HttpError(422, "capacity_exceeded", "Contents exceed the drive's capacity.");
}

export default defineConfig({
  name: "drive-locker",
  tables,
  users: { members },
  relations,
  hooks: {
    places: {
      beforeCreate(data, ctx) {
        data.ownerId = actor(ctx.user?.id);
        data.name = data.name.trim();
        if (!data.name) throw new HttpError(422, "invalid_input", "A place needs a name.");
      },
      beforeUpdate(data, existing) {
        data.ownerId = existing.ownerId;
        if (data.name !== undefined) {
          data.name = data.name.trim();
          if (!data.name) throw new HttpError(422, "invalid_input", "A place needs a name.");
        }
      },
    },
    drives: {
      async beforeCreate(data, ctx) {
        const owner = actor(ctx.user?.id);
        data.ownerId = owner;
        data.label = data.label.trim();
        data.model = data.model.trim();
        data.serial = data.serial.trim().toUpperCase();
        data.interface = data.interface.trim();
        if (!data.label || !data.model || !data.serial || !data.interface) throw new HttpError(422, "invalid_input", "Label, model, serial and interface are required.");
        data.serialKey = `${owner}:${data.serial}`;
        await checkPlace(data.placeId, owner);
      },
      async beforeUpdate(data, existing) {
        data.ownerId = existing.ownerId;
        if (data.serial !== undefined) data.serial = data.serial.trim().toUpperCase();
        data.serialKey = `${existing.ownerId}:${data.serial ?? existing.serial}`;
        if (data.label !== undefined) data.label = data.label.trim();
        if (data.model !== undefined) data.model = data.model.trim();
        if (data.interface !== undefined) data.interface = data.interface.trim();
        if (data.label === "" || data.model === "" || data.serial === "" || data.interface === "") throw new HttpError(422, "invalid_input", "Drive fields cannot be blank.");
        await checkPlace(data.placeId, existing.ownerId);
        const capacityGb = data.capacityGb;
        if (capacityGb !== undefined) {
          const entries = await db.query.contents.findMany({ where: { driveId: existing.id, ownerId: existing.ownerId } });
          if (entries.reduce((sum, entry) => sum + entry.usedGb, 0) > capacityGb) throw new HttpError(422, "capacity_exceeded", "Capacity is smaller than the recorded contents.");
        }
      },
    },
    healthReadings: {
      async beforeCreate(data, ctx) {
        const owner = actor(ctx.user?.id);
        data.ownerId = owner;
        await requireDrive(data.driveId, owner);
      },
      async beforeUpdate(data, existing) {
        data.ownerId = existing.ownerId;
        await requireDrive(data.driveId ?? existing.driveId, existing.ownerId);
      },
    },
    contents: {
      async beforeCreate(data, ctx) {
        const owner = actor(ctx.user?.id);
        data.ownerId = owner;
        data.description = data.description.trim();
        if (!data.description) throw new HttpError(422, "invalid_input", "Describe the contents.");
        await checkUsage(data.driveId, owner, data.usedGb, 0);
      },
      async beforeUpdate(data, existing) {
        data.ownerId = existing.ownerId;
        if (data.description !== undefined) {
          data.description = data.description.trim();
          if (!data.description) throw new HttpError(422, "invalid_input", "Describe the contents.");
        }
        await checkUsage(data.driveId ?? existing.driveId, existing.ownerId, data.usedGb ?? existing.usedGb, existing.id);
      },
    },
  },
  jobs: {
    stampReplacement: job({
      input: { driveId: integer(), ownerId: integer(), flaggedAt: timestamp() },
      retries: 2,
      async handler({ driveId, ownerId, flaggedAt }) {
        await db.update(drives).set({ replacementNeededAt: flaggedAt })
          .where({ id: driveId, ownerId, replacementNeededAt: { isNull: true } });
      },
    }),
  },
  actions: {
    logHealth: action({
      access: "authenticated",
      input: {
        driveId: integer(), readOn: date(),
        powerOnHours: integer().min(0), wearPercent: number().min(0).max(100),
        reallocatedSectors: integer().min(0), tempC: number().min(-40).max(150),
      },
      async handler(input, ctx) {
        const ownerId = actor(ctx.user?.id);
        await requireDrive(input.driveId, ownerId);
        const previous = await db.query.healthReadings.findFirst({
          where: { driveId: input.driveId, ownerId }, orderBy: { readOn: "desc", id: "desc" },
        });
        if (previous && input.readOn <= previous.readOn) throw new HttpError(422, "reading_order", "Use a date after the latest reading.");
        if (previous && (input.powerOnHours < previous.powerOnHours || input.wearPercent < previous.wearPercent || input.reallocatedSectors < previous.reallocatedSectors)) throw new HttpError(422, "counter_decreased", "Lifetime counters cannot decrease. Check the drive and units.");
        const wearRise = previous ? input.wearPercent - previous.wearPercent : 0;
        const sectorRise = previous ? input.reallocatedSectors - previous.reallocatedSectors : 0;
        let verdict = "ok";
        if (input.wearPercent >= HEALTH.watchWear || input.reallocatedSectors > 0 ||
            input.tempC >= HEALTH.watchTemp || wearRise >= HEALTH.watchWearRise || sectorRise > 0) verdict = "watch";
        if (input.wearPercent >= HEALTH.replaceWear || input.reallocatedSectors >= HEALTH.replaceSectors ||
            input.tempC >= HEALTH.replaceTemp || wearRise >= HEALTH.replaceWearRise || sectorRise >= HEALTH.replaceSectorRise) verdict = "replace";
        const [reading] = await db.insert(healthReadings).values({ ...input, ownerId }).returning();
        if (!reading) throw new HttpError(500, "reading_failed", "The reading could not be saved.");
        if (verdict === "replace") await jobs.stampReplacement.enqueue({
          driveId: input.driveId, ownerId, flaggedAt: new Date().toISOString(),
        }, { key: `replace-${ownerId}-${input.driveId}` });
        return { reading, verdict };
      },
    }),
    whereIs: action({
      access: "authenticated",
      input: { query: text().min(1).max(160) },
      async handler({ query }, ctx) {
        const ownerId = actor(ctx.user?.id);
        const needle = query.trim().toLowerCase();
        if (!needle) throw new HttpError(422, "invalid_input", "Enter a serial, label, model or content description.");
        const inventory = await db.query.drives.findMany({ where: { ownerId }, columns: { serialKey: false }, with: { place: true, contents: true }, orderBy: { label: "asc" } });
        return inventory.filter((drive) => drive.serial.toLowerCase().includes(needle) ||
          drive.label.toLowerCase().includes(needle) || drive.model.toLowerCase().includes(needle) ||
          drive.contents.some((entry) => entry.ownerId === ownerId && entry.description.toLowerCase().includes(needle)))
          .map((drive) => ({ drive, place: drive.place, contents: drive.contents }));
      },
    }),
    capacityReport: action({
      access: "authenticated", input: {},
      async handler(_input, ctx) {
        const ownerId = actor(ctx.user?.id);
        const inventory = await db.query.drives.findMany({ where: { ownerId }, with: { contents: true } });
        const locations = await db.query.places.findMany({ where: { ownerId }, orderBy: { name: "asc" } });
        const rows = inventory.map((drive) => ({
          placeId: drive.placeId, kind: drive.kind, totalGb: drive.capacityGb,
          usedGb: drive.contents.filter((entry) => entry.ownerId === ownerId).reduce((sum, entry) => sum + entry.usedGb, 0),
        }));
        const totalGb = rows.reduce((sum, row) => sum + row.totalGb, 0);
        const usedGb = rows.reduce((sum, row) => sum + row.usedGb, 0);
        const byPlace = [...locations.map((place) => ({ placeId: place.id, name: place.name })), { placeId: null, name: "Unassigned" }].map((place) => {
          const selected = rows.filter((row) => row.placeId === place.placeId);
          const totalGb = selected.reduce((sum, row) => sum + row.totalGb, 0);
          const usedGb = selected.reduce((sum, row) => sum + row.usedGb, 0);
          return { placeId: place.placeId, name: place.name, totalGb, usedGb, freeGb: totalGb - usedGb };
        });
        const byKind = ["ssd", "hdd", "nvme", "sd", "usb"].map((kind) => {
          const selected = rows.filter((row) => row.kind === kind);
          const totalGb = selected.reduce((sum, row) => sum + row.totalGb, 0);
          const usedGb = selected.reduce((sum, row) => sum + row.usedGb, 0);
          return { kind, totalGb, usedGb, freeGb: totalGb - usedGb };
        });
        return { totalGb, usedGb, freeGb: totalGb - usedGb, byPlace, byKind };
      },
    }),
    warrantyExpiring: action({
      access: "authenticated", input: { days: integer().min(0).max(3650).default(30) },
      async handler({ days }, ctx) {
        const today = new Date().toISOString().slice(0, 10);
        const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
        return await db.query.drives.findMany({
          where: { ownerId: actor(ctx.user?.id), warrantyUntil: { gte: today, lte: cutoff }, status: { ne: "retired" } },
          columns: { serialKey: false }, orderBy: { warrantyUntil: "asc" }, with: { place: true },
        });
      },
    }),
    retire: action({
      access: "authenticated", input: { driveId: integer() },
      async handler({ driveId }, ctx) {
        const ownerId = actor(ctx.user?.id);
        await requireDrive(driveId, ownerId);
        const [drive] = await db.update(drives).set({ status: "retired" }).where({ id: driveId, ownerId }).returning();
        if (!drive) throw new HttpError(404, "not_found", "Drive not found.");
        const { serialKey, ...visibleDrive } = drive;
        return visibleDrive;
      },
    }),
  },
});
