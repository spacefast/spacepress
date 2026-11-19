import { action, adminScreen, db, email, HttpError, integer, item, job, mail, once } from "typedpress";
import { abilities, get_option } from "php/wordpress";
import { activity, events, registrations } from "./schema";

export const recordEvent = job({
  input: { eventId: integer() }, retries: 3,
  async handler({ eventId }, ctx) {
    await once(ctx.jobId, async () => {
      await db.insert(activity).values({ eventId, summary: "Workshop created" });
    });
  },
});

export const bookSeats = action({
  input: { eventId: integer(), seats: integer().min(1).max(4), email: email() },
  access: "authenticated",
  async handler({ eventId, seats, email }, ctx) {
    const event = await db.query.events.findFirst({ where: { id: eventId, status: "published" } });
    const member = ctx.user;
    if (!member) throw new HttpError(401, "unauthenticated", "Sign in to reserve a seat.");
    if (!event || !event.registrationOpen) {
      throw new HttpError(409, "registration_closed", "This workshop is closed for registration.");
    }
    const existing = await db.query.registrations.findFirst({ where: { eventId, memberId: member.id } });
    if (existing) throw new HttpError(409, "already_registered", "You already have a reservation.");
    const [booking] = await db.insert(registrations).values({ eventId, memberId: member.id, seats }).returning();
    if (!booking) throw new HttpError(500, "internal", "The reservation could not be saved.");
    const kitchen = await db.globals.settings.get();
    await mail.send({
      to: email, replyTo: kitchen.replyTo ?? undefined, subject: `Reservation for ${event.title}`,
      text: `We've reserved ${seats} seat(s). Your booking code is ${booking.code}.`,
    });
    return { code: booking.code };
  },
});

export const upcoming = action({
  input: {},
  access: "editor",
  readonly: true,
  async handler() {
    const rows = await db.query.events.findMany({ where: { status: "published" }, orderBy: { startsOn: "asc" } });
    return { rows };
  },
});

export const closeRegistration = action({
  input: { id: integer() },
  access: "editor",
  async handler({ id }) {
    const [event] = await db.update(events).set({ registrationOpen: false }).where({ id }).returning();
    if (!event) throw new HttpError(404, "not_found", "Workshop not found.");
    return { id };
  },
});

export const checkSchedule = action({
  input: {},
  access: "editor",
  readonly: true,
  async handler() {
    const schedule = await abilities.call("kitchen-sink/upcoming", {});
    return { schedule, timezone: get_option("timezone_string") };
  },
});

export const schedule = adminScreen({
  title: "Workshop schedule",
  access: "editor",
  view: {
    action: upcoming, items: "rows", id: "id",
    fields: { title: { label: "Workshop" }, startsOn: { label: "Date" } },
    layout: { type: "table", titleField: "title", fields: ["startsOn"] },
  },
  actions: [{ id: "close", label: "Close registration", action: closeRegistration, input: { id: item("id") } }],
});
