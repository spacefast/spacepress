import { action, boolean, email, integer, text, HttpError } from "first";

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
