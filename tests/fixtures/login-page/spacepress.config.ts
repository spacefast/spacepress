// sp/app/login.tsx renders wp-login.php's sign-in view (docs/decisions/2026-11-15-one-sign-in-page.md).
// tests/php/login_page.php signs in through it on WordPress, with SpacePress Identity and Two Factor active.
import { defineConfig, email, text, userProjection } from "spacepress";

export const members = userProjection({ email: email().unique().max(191), name: text().max(80) }, {
  access: { read: "self", update: "self", create: "admin", delete: "admin" },
});
export const users = { members };
export default defineConfig({ name: "loginpage" });
