import { defineConfig, mail, mutation } from "typedpress";
export const a = mutation({ access: "anyone" }, async (i: { to: string }) => { return (await mail.send({ to: [i.to, { email: "b@example.test", name: "B" }], subject: "s", html: "<p>h</p>" })).id; });

export default defineConfig({});
