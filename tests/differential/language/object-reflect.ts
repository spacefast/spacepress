// Object.assign, Reflect.ownKeys and Object.prototype.toString.call in imported JavaScript, which
// files-sdk 3.1.2 (`Object.assign(this, surface)`, `Reflect.ownKeys(surface)`), picomatch
// (`Object.assign(picomatch, pico)`), ret (`Object.assign({}, lookup)`) and safe-regex2
// (`Object.prototype.toString.call(x) === '[object RegExp]'`) use at run time. Every action runs
// under Node and as compiled PHP; the JSON results must be byte-identical.
import { action, defineConfig } from "first";
import { assigns, ownKeys, tags } from "./object-reflect-helpers.mjs";

const run = (handler: () => unknown) => action({ input: {}, handler });

export default defineConfig({
  name: "language-object-reflect",
  actions: {
    assigns: run(() => assigns()),
    ownKeys: run(() => ownKeys()),
    tags: run(() => tags()),
  },
});
