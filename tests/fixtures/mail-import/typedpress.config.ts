import { action, defineConfig, mail, text } from "typedpress";
import Welcome from "./emails/welcome";
export const a = action({ input: { to: text() }, access: "anyone",
  async handler(i) { return (await mail.send({ to: [i.to, { email: "b@example.test", name: "B" }], subject: "s", html: "<p>h</p>" })).id; } });
export const welcome = action({ input: { to: text(), name: text() }, access: "anyone",
  async handler(i) { const { html, text } = mail.render(Welcome, { name: i.name }); return (await mail.send({ to: i.to, subject: "Welcome", html, text })).id; } });

export default defineConfig({});
