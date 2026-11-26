import { query, defineConfig } from "spacepress";
import { mail } from "spacepress/server";
import Welcome from "./emails/welcome";
export const welcome = query({ access: "anyone" }, async () => mail.render(Welcome, { name: 1, kind: "welcome" }).html);

export default defineConfig({});
