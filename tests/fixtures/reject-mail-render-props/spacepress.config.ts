import { mutation, defineConfig } from "spacepress";
import Welcome from "./emails/welcome";
export const welcome = mutation({ access: "anyone" }, async ({ mail }) => mail.render(Welcome, { name: 1, kind: "welcome" }).html);

export default defineConfig({});
