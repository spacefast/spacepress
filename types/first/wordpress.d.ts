/**
 * `"php/wordpress"`: WordPress core from a First app. Map it next to `"first"` in tsconfig.json:
 *
 * ```json
 * "paths": { "first": [".../types/index.d.ts"], "php/wordpress": [".../types/wordpress.d.ts"] }
 * ```
 *
 * `first build` augments `Abilities` in `first/_generated/db.d.ts` with the app's own abilities and those locked in
 * `first/_generated/abilities.json` (`first abilities pull --site <url>`).
 */

/** Ability name → `{ input; output }`, generated into `first/_generated/db.d.ts`. */
export interface Abilities {}

export type AbilityName = keyof Abilities & string;
export type AbilityInput<N extends AbilityName> = Abilities[N] extends { input: infer I } ? I : never;
export type AbilityOutput<N extends AbilityName> = Abilities[N] extends { output: infer O } ? O : never;

/**
 * Registered WordPress abilities (the Abilities API), run through core's `WP_Ability::execute()`:
 * core validates the input, checks the ability's permission for the current WordPress user and
 * validates the output. The name must be a string literal.
 *
 * Throws `HttpError(503, "ability_unavailable")` when the site does not have the ability, and maps a
 * `WP_Error` to an `HttpError`: its own `status` when it has one, otherwise 401/403 for a permission
 * failure, 422 for invalid input and 500 for anything else.
 */
export declare const abilities: {
  call<N extends AbilityName>(
    name: N,
    ...input: {} extends AbilityInput<N> ? [input?: AbilityInput<N>] : [input: AbilityInput<N>]
  ): Promise<AbilityOutput<N>>;
};

// ---------------------------------------------------------------------------
// WordPress hooks: `first/wp-hooks/<hook>.ts` or `first/wp-hooks/<hook>/<file>.ts`, each default-exporting a
// handler. Files of one hook run in file-name order; `export const priority = 20` moves one.
// ---------------------------------------------------------------------------

export type HookName = keyof Hooks;

/**
 * The handler a `first/wp-hooks/` file default-exports for hook `H`: an action's returns nothing, a
 * filter's returns the filtered value (its first argument's type).
 *
 * ```ts
 * import type { Handler } from "php/wordpress";
 * const frame: Handler<"the_content"> = (content) => `<div class="frame">${content}</div>`;
 * export default frame;
 * ```
 */
export type Handler<H extends HookName> = Hooks[H] extends { kind: "filter"; args: infer A extends unknown[] }
  ? (...args: A) => A[0]
  : Hooks[H] extends { args: infer A extends unknown[] }
    ? (...args: A) => void
    : never;

// BEGIN GENERATED: scripts/wordpress-catalog.py
/** A read-only view of `WP_Post` as a hook handler receives it. */
export interface WP_Post {
  readonly ID: number;
  readonly post_author: string;
  readonly post_date: string;
  readonly post_date_gmt: string;
  readonly post_content: string;
  readonly post_title: string;
  readonly post_excerpt: string;
  readonly post_status: string;
  readonly comment_status: string;
  readonly post_name: string;
  readonly post_modified: string;
  readonly post_modified_gmt: string;
  readonly post_parent: number;
  readonly guid: string;
  readonly menu_order: number;
  readonly post_type: string;
  readonly post_mime_type: string;
  readonly comment_count: string;
}
/** A read-only view of `WP_User` as a hook handler receives it. */
export interface WP_User {
  readonly ID: number;
  readonly user_login: string;
  readonly user_email: string;
  readonly user_url: string;
  readonly user_registered: string;
  readonly display_name: string;
  readonly user_nicename: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly roles: string[];
}
/** A read-only view of `WP_Query` as a hook handler receives it. */
export interface WP_Query {
  get(query_var: string): unknown;
  set(query_var: string, value: string | number | boolean | string[] | number[]): void;
  is_main_query(): boolean;
}
/** WordPress `get_option()`. */
export declare function get_option(option: string): unknown;
/** WordPress `update_option()`. */
export declare function update_option(option: string, value: unknown): boolean;
/** WordPress `delete_option()`. */
export declare function delete_option(option: string): boolean;
/** WordPress `get_post()`. */
export declare function get_post(post: number): WP_Post | null;
/** WordPress `wp_insert_post()`. Throws an HttpError when WordPress returns a WP_Error. */
export declare function wp_insert_post(postarr: { post_title?: string; post_content?: string; post_excerpt?: string; post_status?: string; post_type?: string; post_name?: string; post_author?: number; post_parent?: number; menu_order?: number }): number;
/** WordPress `current_user_can()`. */
export declare function current_user_can(capability: string): boolean;
/** WordPress `is_user_logged_in()`. */
export declare function is_user_logged_in(): boolean;
/** WordPress `get_current_user_id()`. */
export declare function get_current_user_id(): number;
/** WordPress `get_userdata()`. */
export declare function get_userdata(user_id: number): WP_User | false;
/** WordPress `get_permalink()`. */
export declare function get_permalink(post: number): string | false;
/** WordPress `home_url()`. */
export declare function home_url(path: string): string;
/** WordPress `sanitize_text_field()`. */
export declare function sanitize_text_field(str: string): string;
/** WordPress `sanitize_title()`. */
export declare function sanitize_title(title: string): string;
/** WordPress `esc_html()`. */
export declare function esc_html(text: string): string;
/** WordPress `esc_attr()`. */
export declare function esc_attr(text: string): string;
/** WordPress `esc_url()`. */
export declare function esc_url(url: string): string;
/** WordPress `wp_strip_all_tags()`. */
export declare function wp_strip_all_tags(text: string): string;
/** The WordPress hooks `first/wp-hooks/` accepts: kind and arguments, from core's docblocks. */
export interface Hooks {
  /** Fires after WordPress has finished loading but before any headers are sent. (wp-settings.php) */
  init: { kind: "action"; args: [] };
  /** Prints scripts or data in the head tag on the front end. (wp-includes/general-template.php) */
  wp_head: { kind: "action"; args: [] };
  /** Prints scripts or data before the closing body tag on the front end. (wp-includes/general-template.php) */
  wp_footer: { kind: "action"; args: [] };
  /** Triggered after the opening body tag. (wp-includes/general-template.php) */
  wp_body_open: { kind: "action"; args: [] };
  /** Fires when scripts and styles are enqueued. (wp-includes/script-loader.php) */
  wp_enqueue_scripts: { kind: "action"; args: [] };
  /** Fires before determining which template to load. (wp-includes/template-loader.php) */
  template_redirect: { kind: "action"; args: [] };
  /** Filters the post content. (wp-includes/post-template.php) */
  the_content: { kind: "filter"; args: [content: string] };
  /** Filters the post title. (wp-includes/post-template.php) */
  the_title: { kind: "filter"; args: [post_title: string, post_id: number] };
  /** Filters the displayed post excerpt. (wp-includes/post-template.php) */
  the_excerpt: { kind: "filter"; args: [post_excerpt: string] };
  /** Filters the maximum number of words in a post excerpt. (wp-includes/formatting.php) */
  excerpt_length: { kind: "filter"; args: [number: number] };
  /** Filters the string in the "more" link displayed after a trimmed excerpt. (wp-includes/formatting.php) */
  excerpt_more: { kind: "filter"; args: [more_string: string] };
  /** Filters the list of CSS body class names for the current post or page. (wp-includes/post-template.php) */
  body_class: { kind: "filter"; args: [classes: string[], css_class: string[]] };
  /** Filters the list of CSS class names for the current post. (wp-includes/post-template.php) */
  post_class: { kind: "filter"; args: [classes: string[], css_class: string[], post_id: number] };
  /** Fires once a post has been saved. (wp-includes/post.php) */
  save_post: { kind: "action"; args: [post_id: number, post: WP_Post, update: boolean] };
  /** Fires once a post has been saved. (wp-includes/post.php) */
  wp_insert_post: { kind: "action"; args: [post_id: number, post: WP_Post, update: boolean] };
  /** Fires immediately after a post is deleted from the database. (wp-includes/post.php) */
  deleted_post: { kind: "action"; args: [post_id: number, post: WP_Post] };
  /** Fires when a post is transitioned from one status to another. (wp-includes/post.php) */
  transition_post_status: { kind: "action"; args: [new_status: string, old_status: string, post: WP_Post] };
  /** Fires immediately after a new user is registered. (wp-includes/user.php) */
  user_register: { kind: "action"; args: [user_id: number, userdata: Record<string, unknown>] };
  /** Fires after the user has successfully logged in. (wp-includes/user.php) */
  wp_login: { kind: "action"; args: [user_login: string, user: WP_User] };
  /** Fires after a user is logged out. (wp-includes/pluggable.php) */
  wp_logout: { kind: "action"; args: [user_id: number] };
  /** Fires when preparing to serve a REST API request. (wp-includes/rest-api.php) */
  rest_api_init: { kind: "action"; args: [] };
  /** Filters the wp_mail() arguments. (wp-includes/pluggable.php) */
  wp_mail: { kind: "filter"; args: [args: { to: string | string[]; subject: string; message: string; headers: string | string[]; attachments: string | string[] }] };
  /** Fires after the query variable object is created, but before the actual query is run. (wp-includes/class-wp-query.php) */
  pre_get_posts: { kind: "action"; args: [query: WP_Query] };
  /** Filters the message to display above the login form. (wp-login.php) */
  login_message: { kind: "filter"; args: [message: string] };
}
// END GENERATED
