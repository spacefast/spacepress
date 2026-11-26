import { defineConfig, mutation } from "spacepress";
export const compare = mutation({}, () => "ä".localeCompare("z"));

export default defineConfig({ name: "localecollation" });
