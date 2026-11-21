import { toTypedPress } from "./names.ts";

// The names the compiler on main reads for the entry file, the app folder and the module a config
// imports. The playground shows First names and hands the compiler these. After the rename lands on
// main, they are "typedpress.config.ts", "first" and "first", and both functions below change nothing.
export const compilerEntry = "typedpress.config.ts";
export const compilerRoot = "tp";
export const compilerModule = "typedpress";

const moved = (file: string, from: string, to: string) => (file.startsWith(`${from}/`) ? `${to}/${file.slice(from.length + 1)}` : file);

/** An example's sources as the docs show them: First names, the entry as typedpress.config.ts, app code under tp/. */
export function firstFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([file, text]) => [file === compilerEntry ? "typedpress.config.ts" : moved(file, compilerRoot, "tp"), toTypedPress(text)]));
}

/** What the editor shows, handed back with the names the compiler reads. */
export function compilerFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([file, text]) => [
    file === "typedpress.config.ts" ? compilerEntry : moved(file, "tp", compilerRoot),
    text
      .replace(/(from |import\()(["'])typedpress\2/g, `$1$2${compilerModule}$2`)
      .replace(/(["'])((?:\.\.?\/)+)tp\//g, `$1$2${compilerRoot}/`),
  ]));
}

export const wordpressFiles = [
  { path: "runtime/TypedPress/Wp/Plugin.php", label: "Post types & hooks", find: "register_post_type(", description: "Shared WordPress runtime. Registers native post types, editor support, revisions and WordPress hooks from the generated schema." },
  { path: "runtime/TypedPress/Wp/WpPostStore.php", label: "Post writes", find: "wp_insert_post(", description: "Shared WordPress runtime. Collection writes call wp_insert_post() and wp_update_post(); custom fields use Secure Custom Fields." },
  { path: "runtime/TypedPress/Wp/WpUserStore.php", label: "Users", find: "wp_insert_user(", description: "Shared WordPress runtime. User projections read and write native WordPress accounts and profile fields." },
  { path: "runtime/TypedPress/Wp/Facade.php", label: "API", find: "public static function route(", description: "Shared WordPress runtime. Serves /wp-json/typedpress/v1 by dispatching each request to the core REST route and mapping its answer to TypedPress's shapes." },
  { path: "runtime/TypedPress/Wp/WpMedia.php", label: "Media", find: "add_image_size(", description: "Shared WordPress runtime. Registers image sizes and connects media operations to WordPress attachments." },
  { path: "runtime/TypedPress/Wp/WpTableStore.php", label: "Settings & tables", find: "public function globalRead(", description: "Shared WordPress runtime. Custom-table storage and globals backed by WordPress options through Secure Custom Fields." },
  { path: "runtime/TypedPress/Wp/Scf.php", label: "Custom fields", find: "acf_add_local_field_group(", description: "Shared WordPress runtime. Turns generated field metadata into Secure Custom Fields editor controls." },
  { path: "runtime/TypedPress/Wp/Polylang.php", label: "Translations", find: "pll_set_post_language(", description: "Shared WordPress runtime. Connects localized collections to Polylang languages and translation groups." },
  { path: "runtime/TypedPress/Seam.php", label: "Generated calls to the runtime", find: "public static function insert(", description: "Shared PHP runtime. Generated functions call this layer, which passes operations to the configured WordPress stores." },
  { path: "runtime/TypedPress/Db.php", label: "Database operations", find: "public function insert(", description: "Shared PHP runtime. Applies access rules, validation and hooks before dispatching database operations to the WordPress stores." },
  { path: "runtime/TypedPress/Wp/CompositeStore.php", label: "Storage routing", find: "private function for(", description: "Shared WordPress runtime. Routes each operation to native posts, WordPress users or custom tables using the generated schema." },
  { path: "runtime/TypedPress/Wp/Runtime.php", label: "WordPress boot", find: "public static function boot(", description: "Shared WordPress runtime. Boots the integration, registers activation and init hooks, and loads the generated app schema." },
  { path: "runtime/wp-plugin/typedpress-app.php", label: "App plugin template", find: "register_activation_hook(", description: "App plugin bootstrap template. The CLI fills its {{placeholders}} when it assembles the WordPress plugin." },
  { path: "runtime/wp-plugin/typedpress-runtime.php", label: "Runtime plugin template", find: "Runtime::boot(", description: "Runtime plugin bootstrap template. Loads TypedPress and starts the WordPress integration. The CLI fills its {{placeholders}}." },
] as const;
