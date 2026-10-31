// The members app for the legacy-users suite: an `auth: true` collection shaped like design §6.2,
// with defaults of each usermeta storage form (text, boolean, date, timestamp, multiple select) and
// a column without one.
import { collection, defineConfig, id, text, email, select, boolean, date, timestamp } from "zero";
const members = collection("members", {
  id: id(),
  email: email().notNull().unique().max(191),
  name: text().notNull().max(80),
  plan: select({ options: ["free", "pro"] }).notNull().default("free"),
  newsletter: boolean().notNull().default(true),
  joinedOn: date().default("2026-03-01"),
  welcomedAt: timestamp().default("2026-03-01T12:00:00+02:00"),
  topics: select({ options: ["news", "events", "jobs"], multiple: true }).notNull().default(["news", "events"]),
  bio: text().max(200),
}, { auth: true, access: { read: "self", update: "self", create: "anyone", delete: "admin" } });
export default defineConfig({ name: "members", schema: { members } });
