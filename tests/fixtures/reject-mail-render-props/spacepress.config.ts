import { query, defineConfig, mail } from "spacepress";
import Welcome from "./emails/welcome";
export const welcome = query({ access: "anyone" }, async () => mail.render(Welcome, { name: 1, kind: "welcome" }).html);

export default defineConfig({});
