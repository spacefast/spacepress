import { action, defineConfig } from "typedpress";

// A PHP closure can't carry `match.version`, so the function is only called or member-read.
function match(glob: string) { return glob.length; }
match.version = "1";

export const probe = action({ input: {}, handler: () => [match] });

export default defineConfig({
  name: "reject-function-properties-value",
});
