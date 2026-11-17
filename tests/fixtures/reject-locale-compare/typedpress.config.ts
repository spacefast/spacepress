import { defineConfig, mutation } from "typedpress";
export const compare = mutation({}, () => "ä".localeCompare("z"));

export default defineConfig({ name: "localecollation" });
