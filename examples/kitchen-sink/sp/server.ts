import { cron, mutation, query } from "spacepress";
import { adminDashboard, adminScreen, adminWidget, item } from "spacepress/admin";
import { HttpError } from "spacepress/server";
import {
  abilities, esc_attr, esc_html, esc_url, get_current_user_id, get_option, get_permalink, get_post, get_userdata,
  home_url, sanitize_text_field, wp, wp_insert_post,
} from "spacepress/server/wp";
import Reservation from "../emails/reservation";

// WordPress hooks exported directly via wp.filter() / wp.action().
export const excerptMore = wp.filter("excerpt_more", () => " … keep reading on the journal.");

export const logInit = wp.action("init", () => {});

export const loginWelcome = wp.filter("login_message", (_ctx, message) => {
  const site = String(get_option("blogname"));
  return `${message}<p class="message">Members of ${esc_html(site)} sign in to reserve seats. `
    + `<a href="${esc_url(home_url("/about/"))}" title="${esc_attr(`About ${site}`)}">About the kitchen</a></p>`;
});

// Closes registration each morning for workshops whose date has passed.
export const closePastWorkshops = cron("0 6 * * *", async ({ db }) => {
  const today = new Date().toISOString().slice(0, 10);
  const open = await db.events.list({ where: { registrationOpen: true } });
  for (const event of open) {
    if (event.startsOn < today) {
      await db.events.update(event.id, { registrationOpen: false });
    }
  }
});

export const bookSeats = mutation({ access: "authenticated" }, async ({ db, user, mail }, { eventId, seats, allergies }: { eventId: number; seats: number; allergies?: string }) => {
  if (!Number.isInteger(eventId)) throw new HttpError(422, "invalid_input", "eventId must be an integer", "/eventId");
  if (!Number.isInteger(seats) || seats < 1 || seats > 4) throw new HttpError(422, "invalid_input", "seats must be an integer from 1 to 4", "/seats");
  if (allergies !== undefined && allergies.length > 200) throw new HttpError(422, "invalid_input", "allergies must be at most 200 characters", "/allergies");
  const event = await db.system.events.get({ id: eventId, status: "published" });
  const member = user;
  if (!member) throw new HttpError(401, "unauthenticated", "Sign in to reserve a seat.");
  // The confirmation goes to the account's own address, never to one typed into the form.
  const account = get_userdata(get_current_user_id());
  if (account === false) throw new HttpError(401, "unauthenticated", "Sign in to reserve a seat.");
  if (!event || !event.registrationOpen) {
    throw new HttpError(409, "registration_closed", "This workshop is closed for registration.");
  }
  const existing = await db.system.registrations.get({ eventId, memberId: member.id });
  if (existing) throw new HttpError(409, "already_registered", "You already have a reservation.");
  const allergens = (allergies ?? "").split(",").map((entry) => sanitize_text_field(entry)).filter((entry) => entry !== "");
  const booking = await db.system.registrations.create({ eventId, memberId: member.id, seats, preferences: { allergens } });
  const kitchen = await db.settings.get();
  const body = mail.render(Reservation, {
    name: account.display_name, workshop: event.title, startsOn: event.startsOn, seats,
    code: booking.code, url: get_permalink(event.id) || "", kitchen: kitchen.siteTitle,
  });
  await mail.send({
    to: { email: account.user_email, name: account.display_name },
    subject: `Reservation for ${event.title}`,
    html: body.html, text: body.text,
    from: kitchen.mailFrom ? { email: kitchen.mailFrom, name: kitchen.siteTitle } : null,
    replyTo: kitchen.replyTo,
  });
  return { code: booking.code };
});

// The contact page's form: anyone may write, and the message is mailed to the site's admin address
// after the request commits. The visitor's address is the Reply-To, never the sender.
export const contactKitchen = mutation({ access: "anyone", rateLimit: "5/hour" }, async ({ mail }, { email, message }: { email: string; message: string }) => {
  if (email.length > 191 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) throw new HttpError(422, "invalid_input", "email must be an email address", "/email");
  if (message.length < 3 || message.length > 2000) throw new HttpError(422, "invalid_input", "message must be 3 to 2000 characters", "/message");
  const sent = await mail.send({
    to: String(get_option("admin_email")),
    subject: "A message from the contact page",
    text: message,
    replyTo: email,
  });
  return { delivery: sent.id };
});

export const cancelSeats = mutation({ access: "authenticated" }, async ({ db, user }, { eventId }: { eventId: number }) => {
  if (!Number.isInteger(eventId)) throw new HttpError(422, "invalid_input", "eventId must be an integer", "/eventId");
  const member = user;
  if (!member) throw new HttpError(401, "unauthenticated", "Sign in to cancel a reservation.");
  const existing = await db.system.registrations.get({ eventId, memberId: member.id });
  if (!existing) throw new HttpError(404, "not_found", "You have no reservation for this workshop.");
  const cancelled = await db.system.registrations.delete(existing.id);
  return { seats: cancelled.seats };
});

export const upcoming = query({ access: "editor" }, async ({ db }) => {
  const rows = await db.events.list({ where: { status: "published" }, orderBy: { startsOn: "asc" } });
  return { rows };
});

export const closeRegistration = mutation({ access: "editor" }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const event = await db.events.update(id, { registrationOpen: false });
  return { id: event.id };
});

export const scheduleAgain = mutation({ access: "editor" }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const source = await db.events.get(id);
  if (!source) throw new HttpError(404, "not_found", "Workshop not found.");
  // The same class a week later, as a draft for an editor to review.
  const nextWeek = new Date(new Date(source.startsOn).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const copy = await db.events.create({
    title: source.title, startsOn: nextWeek, venue: source.venue, format: source.format,
    equipment: source.equipment, status: "draft",
  });
  return { id: copy.id, startsOn: copy.startsOn };
});

export const cancelWorkshop = mutation({ access: "admin", destructive: true }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const gone = await db.events.delete(id);
  return { id: gone.id };
});

export const restoreWorkshop = mutation({ access: "admin" }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const back = await db.events.restore(id);
  return { id: back.id };
});

export const purgeWorkshop = mutation({ access: "admin", destructive: true }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const gone = await db.events.purge(id);
  return { id: gone.id };
});

export const workshopHistory = query({ access: "editor" }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const list = await db.events.revisions.list(id);
  const first = list.length > 0 ? await db.events.revisions.get(id, list[list.length - 1]!.version) : null;
  const diff = list.length >= 2 ? await db.events.revisions.diff(id, list[list.length - 1]!.version, list[0]!.version) : null;
  return { count: list.length, firstTitle: first?.title ?? null, diff };
});

export const revertWorkshop = mutation({ access: "editor" }, async ({ db }, { id, version }: { id: number; version: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  if (!Number.isInteger(version) || version < 1) throw new HttpError(422, "invalid_input", "version must be positive", "/version");
  const restored = await db.events.revisions.restore(id, version);
  return { id: restored.id, title: restored.title };
});

// The banner the layout shows on every page. Clearing the field takes it down.
export const postAnnouncement = mutation({ access: "editor" }, async ({ db }, { announcement }: { announcement?: string }) => {
  if (announcement !== undefined && announcement.length > 280) throw new HttpError(422, "invalid_input", "announcement must be at most 280 characters", "/announcement");
  const saved = await db.system.settings.update({ announcement: announcement ? sanitize_text_field(announcement) : null });
  return { announcement: saved.announcement };
});

// Starts a journal post about a workshop as a WordPress draft, for an editor to finish.
export const draftRecap = mutation({ access: "editor" }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const event = await db.system.events.get(id);
  if (!event) throw new HttpError(404, "not_found", "Workshop not found.");
  const postId = wp_insert_post({
    post_title: `Recap: ${event.title}`, post_status: "draft", post_type: "post",
    post_content: `<!-- wp:paragraph --><p>Notes from ${event.title} on ${event.startsOn}.</p><!-- /wp:paragraph -->`,
  });
  const draft = get_post(postId);
  return { postId, title: draft ? draft.post_title : "", status: draft ? draft.post_status : "" };
});

async function readScheduleSummary() {
  const open = await abilities.call("kitchen-sink/events-list", { where: { registrationOpen: true }, limit: 100 });
  return {
    workshops: open.rows.length,
    timezone: String(get_option("timezone_string") || "UTC"),
    hasWorkshops: Boolean(get_option("kitchen_has_workshops")),
  };
}

export const checkSchedule = mutation({ access: "editor" }, async () => await readScheduleSummary());

export const scheduleMetrics = query({ access: "editor" }, async () => await readScheduleSummary());

export const schedule = adminScreen({
  title: "Workshop schedule",
  access: "editor",
  view: {
    action: upcoming, items: "rows", id: "id",
    fields: { title: { label: "Workshop" }, startsOn: { label: "Date" } },
    layout: { type: "table", titleField: "title", fields: ["startsOn"] },
  },
  actions: [
    { id: "close", label: "Close registration", action: closeRegistration, input: { id: item("id") } },
    { id: "recap", label: "Draft a journal recap", action: draftRecap, input: { id: item("id") } },
    { id: "repeat", label: "Schedule again next week", action: scheduleAgain, input: { id: item("id") } },
    {
      id: "cancel", label: "Cancel workshop", action: cancelWorkshop, input: { id: item("id") },
      confirm: "Cancel this workshop? It is deleted for good, unless it has reservations.",
    },
  ],
});

export const scheduleSummary = adminWidget({
  title: "Open workshops",
  description: "Live count of workshops currently accepting registrations.",
  access: "editor",
  action: scheduleMetrics,
  display: "metrics",
  metrics: [
    { id: "workshops", label: "Open workshops", path: "workshops" },
    { id: "timezone", label: "Timezone", path: "timezone" },
  ],
  width: 2,
  height: 1,
  link: { label: "Manage schedule", to: "/screens/schedule" },
});

export const studioOverview = adminDashboard({
  title: "Studio overview",
  description: "Workshops, open seats, and recent updates.",
  access: "editor",
  menu: { icon: "chartBar" },
  widgets: [
    { widget: scheduleSummary, width: 2, height: 1 },
    { widget: "sp/content-overview", width: 2, height: 2 },
    { widget: "sp/recent-activity", width: 2, height: 2 },
  ],
});
