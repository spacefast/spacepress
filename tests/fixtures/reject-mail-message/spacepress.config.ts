import { defineConfig, mail, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, async (i: { to: string }) => { return (await mail.send({ to: i.to, subject: "no body" })).id; });

export default defineConfig({});
