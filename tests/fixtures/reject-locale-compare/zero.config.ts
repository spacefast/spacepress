import { action, defineConfig } from "zero";
export default defineConfig({ name: "localecollation", actions: {
  compare: action({ input: {}, handler: () => "ä".localeCompare("z") }),
} });
