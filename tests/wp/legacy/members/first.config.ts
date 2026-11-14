// The members app for the legacy-users suite: a user projection shaped like design §6.2,
// with defaults of each usermeta storage form (text, boolean, date, timestamp, multiple select) and
// a column without one.
import { defineConfig, text, email, select, boolean, date, timestamp, userProjection } from "first";
export const members = userProjection({
  email: email().unique().max(191),
  name: text().max(80),
  plan: select(["free", "pro"]).default("free"),
  newsletter: boolean().default(true),
  joinedOn: date().default("2026-03-01").optional(),
  welcomedAt: timestamp().default("2026-03-01T12:00:00+02:00").optional(),
  topics: select(["news", "events", "jobs"]).many().default(["news", "events"]),
  bio: text().max(200).optional(),
}, { access: { read: "self", update: "self", create: "anyone", delete: "admin" } });
export default defineConfig({ name: "members" });
