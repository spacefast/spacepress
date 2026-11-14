import { action, defineConfig } from "first";

// crypto.subtle.digest compiles in imported JavaScript; typed code hashes with node:crypto.
export default defineConfig({
  actions: {
    hash: action({ input: {}, handler: async () => ({ size: (await crypto.subtle.digest("SHA-256", new Uint8Array(0))).byteLength }) }),
  },
});
