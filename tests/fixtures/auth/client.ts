// Compiled against the generated client of ./zero.config.ts (tests/compiler.rs): what the types
// allow and refuse for an auth collection (§6.2).
import { createClient, type Member, type Role, type User } from "./zero/client/index.ts";

const zero = createClient({ url: "http://localhost/api" });
const roles: Role[] = ["guest", "subscriber", "author", "editor", "admin"];
const me: User | null = await zero.auth.me();
const member: Member | null | undefined = me?.member;
const plan: "free" | "pro" | undefined = member?.plan;

// password is write-only: accepted on create and update, never on a row.
await zero.members.create({ email: "a@example.test", name: "A", password: "correct horse battery" });
await zero.members.update(1, { password: "a new long password" });
// A patch may leave out a sub-field the viewer can't set (the stored value is kept, §4.3);
await zero.members.update(1, { billing: { city: "Oslo" } });
await zero.members.update(1, { profile: { bio: "hi" } }); // the protected grandchild's group too
// a create still needs it.
// @ts-expect-error tier is required on insert
await zero.members.create({ email: "b@example.test", name: "B", billing: { city: "Oslo" } });
// @ts-expect-error a row never carries the password
const leaked: string = (await zero.members.get(1)).password;
// @ts-expect-error hidden columns aren't on the row
const hash: string = (await zero.members.get(1)).passwordHash;
// @ts-expect-error nor can a query filter on them
await zero.members.list({ where: { passwordHash: { isNull: true } } });
// @ts-expect-error nor order by them
await zero.members.list({ orderBy: { suspendedAt: "desc" } });
// @ts-expect-error nor write them
await zero.members.update(1, { guest: true });

export { roles, plan, leaked, hash };
