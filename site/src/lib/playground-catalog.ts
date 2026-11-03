export const playgroundExamples = [
  { name: "kitchen-sink", label: "Kitchen sink", description: "WordPress posts, revisions, users, custom fields, settings, media, translations, background jobs and plugin dependencies." },
  { name: "blog", label: "Blog", description: "A publication with authors, localized posts, comments, moderation and member accounts." },
  { name: "pantry", label: "Pantry", description: "Custom SQL tables, relations, hooks, actions and a stock notification job." },
  { name: "recipes", label: "Reusable fields", description: "A WordPress article collection with an imported SEO field factory." },
  { name: "wp-plugins", label: "Plugin dependencies", description: "A WordPress notes collection that pins the Classic Editor plugin." },
] as const;

export const wordpressFiles = [
  { path: "runtime/Zero/Wp/Plugin.php", label: "Post types & hooks", find: "register_post_type(", description: "Shared WordPress runtime. Registers native post types, editor support, revisions and WordPress hooks from the generated schema." },
  { path: "runtime/Zero/Wp/WpPostStore.php", label: "Post writes", find: "wp_insert_post(", description: "Shared WordPress runtime. Collection writes call wp_insert_post() and wp_update_post(); custom fields use Secure Custom Fields." },
  { path: "runtime/Zero/Wp/WpUserStore.php", label: "Users", find: "wp_insert_user(", description: "Shared WordPress runtime. User projections read and write native WordPress accounts and profile fields." },
  { path: "runtime/Zero/Wp/Rest.php", label: "REST routes", find: "register_rest_route(", description: "Shared WordPress runtime. Registers the Zero REST routes inside WordPress." },
  { path: "runtime/Zero/Wp/WpMedia.php", label: "Media", find: "add_image_size(", description: "Shared WordPress runtime. Registers image sizes and connects media operations to WordPress attachments." },
  { path: "runtime/Zero/Wp/WpTableStore.php", label: "Settings & tables", find: "public function globalRead(", description: "Shared WordPress runtime. Custom-table storage and globals backed by WordPress options through Secure Custom Fields." },
  { path: "runtime/Zero/Wp/Scf.php", label: "Custom fields", find: "acf_add_local_field_group(", description: "Shared WordPress runtime. Turns generated field metadata into Secure Custom Fields editor controls." },
  { path: "runtime/Zero/Wp/Polylang.php", label: "Translations", find: "pll_set_post_language(", description: "Shared WordPress runtime. Connects localized collections to Polylang languages and translation groups." },
  { path: "runtime/Zero/Seam.php", label: "Generated calls → runtime", find: "public static function insert(", description: "Shared PHP runtime. Generated functions call this layer, which passes operations to the configured WordPress stores." },
  { path: "runtime/Zero/Db.php", label: "Database operations", find: "public function insert(", description: "Shared PHP runtime. Applies access rules, validation and hooks before dispatching database operations to the WordPress stores." },
  { path: "runtime/Zero/Wp/CompositeStore.php", label: "Storage routing", find: "private function for(", description: "Shared WordPress runtime. Routes each operation to native posts, WordPress users or custom tables using the generated schema." },
  { path: "runtime/Zero/Wp/Runtime.php", label: "WordPress boot", find: "public static function boot(", description: "Shared WordPress runtime. Boots the integration, registers activation and init hooks, and loads the generated app schema." },
  { path: "runtime/wp-plugin/zero-app.php", label: "App plugin template", find: "register_activation_hook(", description: "App plugin bootstrap template. The CLI fills its {{placeholders}} when assembling the WordPress plugin." },
  { path: "runtime/wp-plugin/zero-runtime.php", label: "Runtime plugin template", find: "Runtime::boot(", description: "Runtime plugin bootstrap template. Loads Zero and starts the WordPress integration; the CLI fills its {{placeholders}}." },
] as const;
