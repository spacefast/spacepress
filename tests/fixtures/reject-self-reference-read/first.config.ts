import { action, defineConfig } from "first";
// A direct read while the binding initializes throws a ReferenceError in JavaScript.
export default defineConfig({ actions: { probe: action({ handler: () => { const f = (f(), () => 1); return f(); } }) } });
