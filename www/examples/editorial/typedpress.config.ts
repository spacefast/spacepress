import { defineConfig } from "typedpress";

export * from "./tp/schema";
export * from "./tp/actions";

export default defineConfig({
  name: "editorial",
  seed: true,
});
