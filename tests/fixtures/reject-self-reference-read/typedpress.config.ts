import { defineConfig, mutation } from "typedpress";
// A direct read while the binding initializes throws a ReferenceError in JavaScript.
export const probe = mutation({}, () => { const f = (f(), () => 1); return f(); });

export default defineConfig({});
