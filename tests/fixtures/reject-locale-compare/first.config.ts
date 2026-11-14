import { action, defineConfig } from "first";
export const compare = action({ input: {}, handler: () => "ä".localeCompare("z") });

export default defineConfig({ name: "localecollation" });
