import { action, defineConfig, mail } from "typedpress";
import Welcome from "./emails/welcome";
export const welcome = action({ input: {}, access: "anyone", async handler() { return mail.render(Welcome, { name: 1, kind: "welcome" }).html; } });

export default defineConfig({});
