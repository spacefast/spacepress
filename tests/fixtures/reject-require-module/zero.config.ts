const fs = require("node:fs");
import { action, defineConfig } from "zero";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone", handler() { return typeof fs; } }) } });
