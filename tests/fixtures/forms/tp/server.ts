import { action, boolean, db, email, integer, text, HttpError } from "typedpress";
import { entries } from "./schema";

export const subscribe = action({
  input: { email: email(), seats: integer(), weekly: boolean(), note: text().optional() },
  access: "anyone",
  async handler({ email, seats, weekly, note }) {
    if (seats > 5) throw new HttpError(422, "too_many", "Five seats at most");
    return { email, seats, weekly, note: note ?? null };
  },
});

// Only a signed-in user may run it: a signed-out form post comes back with the refusal.
export const members = action({
  input: { name: text() },
  access: "subscriber",
  async handler({ name }, ctx) {
    return `${name} by ${ctx.user?.id ?? 0}`;
  },
});

// Two buttons with one name (one of them outside the form, with `form="vote"`): the pressed one's
// value is the input.
export const vote = action({
  input: { choice: text() },
  access: "anyone",
  async handler({ choice }) {
    return choice;
  },
});

// Adds an entry: the `<Live>` list on /live shows it.
export const sign = action({
  input: { name: text() },
  access: "anyone",
  async handler({ name }) {
    await db.insert(entries).values({ name });
    return name;
  },
});

// Removes the entry the page at /entries/:id shows: the page the form comes back to is a 404 now.
export const remove = action({
  input: { id: integer() },
  access: "anyone",
  async handler({ id }) {
    await db.delete(entries).where({ id });
    return id;
  },
});

// Closes the poll: the page it comes back to renders its button disabled.
export const close = action({
  input: {},
  access: "anyone",
  async handler() {
    await db.insert(entries).values({ name: "closed" });
    return true;
  },
});
