// sp/app/login.tsx renders wp-login.php's sign-in view (docs/decisions/2026-11-15-one-sign-in-page.md).
// tests/php/login_page.php signs in through it on WordPress, with SpacePress Identity and Two Factor active.
import { defineConfig, extend, f } from "spacepress";

export const users = extend("users", {
  fields: { name: f.text().max(80) },
  access: { read: "self", update: "self", create: "admin", delete: "admin" },
});
export default defineConfig({ name: "loginpage" });
