// `import { … } from "zero:db"` gives each registered kind by name (docs/spec/spec.md §2.1), typed
// from the registration in register.ts, and refuses a name the app doesn't register.
import { posts, items } from "zero:db";
import { db } from "zero";
import { posts as declared } from "./schema";

// The same kind the module declared: usable wherever the declaration is.
const same: typeof declared = posts;
// @ts-expect-error: a kind is not a number
const wrong: number = posts;
void wrong;
void same;
export async function bump(id: number) {
  await db.update(items).set({ quantity: 2 }).where({ id });
  // @ts-expect-error: not a column of items
  await db.update(items).set({ nope: 1 }).where({ id });
}

// @ts-expect-error: not a registered kind
import { missing } from "zero:db";
void missing;
