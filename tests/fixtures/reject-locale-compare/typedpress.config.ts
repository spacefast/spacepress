import { action, defineConfig } from "typedpress";
export const compare = action({ input: {}, handler: () => "ä".localeCompare("z") });

export default defineConfig({ name: "localecollation" });
