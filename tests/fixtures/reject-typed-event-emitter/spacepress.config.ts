import { defineConfig, mutation } from "spacepress";
import { EventEmitter } from "node:events";

class Counter extends EventEmitter {
  value = 0;
}

export const probe = mutation({}, () => new Counter().value);
export default defineConfig({ name: "typedeventemitter" });
