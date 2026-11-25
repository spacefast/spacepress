import { defineConfig, mail, mutation } from "spacepress";
import Welcome from "./emails/welcome";
export const a = mutation({ access: "anyone" }, async (i: { to: string }) => { return (await mail.send({ to: [i.to, { email: "b@example.test", name: "B" }], subject: "s", html: "<p>h</p>" })).id; });
export const welcome = mutation({ access: "anyone" }, async (i: { to: string; name: string }) => { const { html, text } = mail.render(Welcome, { name: i.name, kind: "welcome" }); return (await mail.send({ to: i.to, subject: "Welcome", html, text })).id; });

export default defineConfig({});
