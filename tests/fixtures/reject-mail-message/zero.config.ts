import { action, defineConfig, mail, text } from "zero";
export default defineConfig({ actions: { a: action({ input: { to: text().notNull() }, access: "anyone",
  async handler(i) { return (await mail.send({ to: i.to, subject: "no body" })).id; } }) } });
