import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, async ({ mail }, i: { to: string }) => { return (await mail.send({ to: i.to, subject: "no body" })).id; });

export default defineConfig({});
