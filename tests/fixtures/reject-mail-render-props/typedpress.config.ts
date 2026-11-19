import { action, defineConfig, mail } from "typedpress";
import Welcome from "./emails/welcome";
export const welcome = action({ input: {}, access: "anyone", async handler() { return mail.render(Welcome, { name: 1 }).html; } });

export default defineConfig({});
