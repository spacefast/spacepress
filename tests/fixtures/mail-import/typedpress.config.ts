import { action, defineConfig, mail, text } from "typedpress";
export const a = action({ input: { to: text() }, access: "anyone",
  async handler(i) { return (await mail.send({ to: [i.to, { email: "b@example.test", name: "B" }], subject: "s", html: "<p>h</p>" })).id; } });

export default defineConfig({});
