import { action, defineConfig } from "first";
export default defineConfig({ name: "localecollation", actions: {
  compare: action({ input: {}, handler: () => "ä".localeCompare("z") }),
} });
