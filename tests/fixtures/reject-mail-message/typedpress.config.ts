import { action, defineConfig, mail, text } from "typedpress";
export const a = action({ input: { to: text() }, access: "anyone",
  async handler(i) { return (await mail.send({ to: i.to, subject: "no body" })).id; } });

export default defineConfig({});
