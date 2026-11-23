import { boolean, db, email, HttpError, mutation } from "typedpress";
import { entries } from "./schema";

export const subscribe = mutation({ access: "anyone" }, async ({ email, seats, weekly, note }: { email: string; seats: number; weekly: boolean; note?: string; password?: string }) => {
  if (!Number.isInteger(seats)) throw new HttpError(422, "invalid_input", "seats must be an integer", "/seats");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, "invalid_input", "email must be an email address", "/email");
  if (seats > 5) throw new HttpError(422, "too_many", "Five seats at most");
  return { email, seats, weekly, note: note ?? null };
});

// Only a signed-in user may run it: a signed-out form post comes back with the refusal.
export const members = mutation({ access: "subscriber" }, async ({ name }: { name: string }, ctx) => {
  return `${name} by ${ctx.user?.id ?? 0}`;
});

// Two buttons with one name (one of them outside the form, with `form="vote"`): the pressed one's
// value is the input.
export const vote = mutation({ access: "anyone" }, async ({ choice }: { choice: string }) => {
  return choice;
});

// Adds an entry: the `<Live>` list on /live shows it.
export const sign = mutation({ access: "anyone" }, async ({ name }: { name: string }) => {
  await db.insert(entries).values({ name });
  return name;
});

// Removes the entry the page at /entries/:id shows: the page the form comes back to is a 404 now.
export const remove = mutation({ access: "anyone" }, async ({ id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  await db.delete(entries).where({ id });
  return id;
});

// Closes the poll: the page it comes back to renders its button disabled.
export const close = mutation({ access: "anyone" }, async () => {
  await db.insert(entries).values({ name: "closed" });
  return true;
});

// Renames an entry: one form per row on /rows, each filled from the stored name, with a choice of
// tags (a list) and a size (a radio group with a default). An empty name is refused.
export const rename = mutation({ access: "anyone" }, async ({ id, name, tags, size }: { id: number; name: string; tags?: ("red" | "blue" | "green")[]; size?: string }) => {
  if (name.trim().length < 2) throw new HttpError(422, "invalid_input", "name must be two characters or more", "/name");
  await db.update(entries).set({ name }).where({ id });
  return { name, tags: (tags ?? []).join(","), size: size ?? "m" };
});
