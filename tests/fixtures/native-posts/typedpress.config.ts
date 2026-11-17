// WordPress's own posts in an app (tests/php/native_posts_test.php): `wp.posts.extend()` adds fields to
// core's `post` type, and `wp.posts.clone()` makes another kind shaped like posts.
import { defineConfig } from "typedpress";

export * from "./tp/schema";

export default defineConfig({ name: "nativeposts" });
