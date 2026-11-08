import { action, defineConfig } from "zero";

// A PHP closure can't carry `match.version`, so the function is only called or member-read.
function match(glob: string) { return glob.length; }
match.version = "1";

export default defineConfig({
  name: "reject-function-properties-value",
  actions: { probe: action({ input: {}, handler: () => [match] }) },
});
