import { defineConfig } from "spacepress";

export * from "./sp/schema";
export * from "./sp/actions";

export default defineConfig({
  name: "editorial",
  seed: true,
});
