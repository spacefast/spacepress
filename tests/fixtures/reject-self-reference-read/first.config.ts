import { action, defineConfig } from "first";
// A direct read while the binding initializes throws a ReferenceError in JavaScript.
export const probe = action({ handler: () => { const f = (f(), () => 1); return f(); } });

export default defineConfig({});
