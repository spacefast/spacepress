// Compiled against the generated client of ./first.config.ts (tests/compiler.rs): what the types
// allow and refuse for an auth collection (§6.2).
import { createClient, type Member, type Role, type User } from "./first/_generated/client/index.ts";

const first = createClient({ url: "http://localhost/__first/api/v1" });
const roles: Role[] = ["guest", "subscriber", "author", "editor", "admin"];
const me: User | null = await first.auth.me();
const member: Member | null | undefined = me?.member;
const plan: "free" | "pro" | undefined = member?.plan;

// password is write-only: accepted on create and update, never on a row.
await first.members.create({ email: "a@example.test", name: "A", password: "correct horse battery" });
await first.members.update(1, { password: "a new long password" });
// A patch may leave out a sub-field the viewer can't set (the stored value is kept, §4.3);
await first.members.update(1, { billing: { city: "Oslo" } });
await first.members.update(1, { profile: { bio: "hi" } }); // the protected grandchild's group too
// a create still needs it.
// @ts-expect-error tier is required on insert
await first.members.create({ email: "b@example.test", name: "B", billing: { city: "Oslo" } });
// @ts-expect-error a row never carries the password
const leaked: string = (await first.members.get(1)).password;
// @ts-expect-error hidden columns aren't on the row
const hash: string = (await first.members.get(1)).passwordHash;
// @ts-expect-error nor can a query filter on them
await first.members.list({ where: { passwordHash: { isNull: true } } });
// @ts-expect-error nor order by them
await first.members.list({ orderBy: { suspendedAt: "desc" } });
// @ts-expect-error nor write them
await first.members.update(1, { guest: true });

export { roles, plan, leaked, hash };
