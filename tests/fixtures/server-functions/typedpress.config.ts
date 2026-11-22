import { defineConfig } from "typedpress";

// query(), mutation(), job(options, handler), cron() and x.enqueue() on WordPress
// (tests/php/server_functions.php, driven by tests/compiler.rs).
export default defineConfig({ name: "fns" });
