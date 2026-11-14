import { action, defineConfig } from "first";
function identity<T>(value: T): T { return value; }
export const example = action({ input: {}, handler: () => { return identity(1); } });

export default defineConfig({});
