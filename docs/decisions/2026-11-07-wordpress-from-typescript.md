# WordPress from TypeScript: `php/` modules, abilities, hooks, functions

Zero apps run inside WordPress, so a handler should be able to use what the
site already has: abilities other plugins register, core actions and filters,
and core functions. Each of these must stay typed and compile to PHP like the
rest of an app: no raw PHP strings, no `eval`, no JavaScript shipped to the
site.

## Modules mirror PHP's layout

WordPress lives in its own modules, never in `"zero"`:

| Module | What it holds |
|---|---|
| `"php/wordpress"` | WordPress core: `abilities`, the hook types, and a curated set of core functions |
| `"php/<plugin-slug>"` | A pinned plugin that publishes stubs (`"php/woocommerce"`); later work |
| `"php"` | A short allowlist of plain PHP built-ins with no JavaScript equivalent; later work |

There are no `abilities` or `wpHooks` keys in `defineConfig`. A module name
says where the PHP lives, so a reader can find the real documentation, and a
capability gate can count uses per module.

## Abilities (PR 1)

`import { abilities } from "php/wordpress"`, then
`await abilities.call("vendor/name", input)`. The name must be a string
literal, so the compiler can type the input and the result. The call compiles
to `Zero\Wp\Abilities\Call::run($name, $input)`, which runs core's
`WP_Ability::execute()`: core validates input, checks the ability's permission
for the current WordPress user, runs it and validates output.

- **Where the types come from.** The app's own collection, action and global
  abilities are typed from the schema, with no pull. Other abilities come from
  the committed lock `zero/abilities.json`, written by
  `zero abilities pull --site <url>`. Build and check read only that file and
  never touch the network. The lock's types go into `zero.gen.ts`, which
  tsconfig already includes; there is no second generated file to wire up.
- **Own action results are `unknown`.** The ability's own output schema is
  empty (core does not validate it), and a typed result would depend on which
  handler compiles first. Read an action's result through narrowing, or call
  the shared function directly.
- **Errors.** A name the site does not have at run time throws
  `HttpError(503, "ability_unavailable")`: the app was built against a lock
  the site no longer satisfies. A `WP_Error` keeps its `status` when it has
  one; otherwise core's `ability_invalid_permissions` is 401 or 403
  (`unauthenticated`/`forbidden`), `ability_invalid_input` is 422
  (`invalid_input`), and anything else is 500 with the ability's own code.
  A Zero ability's own error comes back unchanged.
- **Transactions.** The call runs inside the handler's transaction. Writes the
  ability makes through `$wpdb` roll back with the handler's when it throws.
- **JSON Schema to TypeScript.** Covered: `type` (including lists with
  `"null"`), `properties`/`required` (and draft-03 `required: true`), arrays
  with one `items` schema, `enum`, `const`, `oneOf`/`anyOf` as unions,
  `additionalProperties` as a record when there are no properties. Validation
  keywords (`format`, `minimum`, `pattern`) stay runtime checks. `allOf`,
  `$ref`, `not`, `patternProperties`, tuple `items` and unknown `type` values
  become `unknown` and the pull prints a warning naming the ability and the
  JSON pointer. An object with listed properties is closed: an extra key in an
  input is a compile error, and an output's extra keys are unreadable.
- **Pull.** Lists `GET /wp-abilities/v1/abilities?per_page=100&page=N` (WordPress
  7.1.4: `name`, `label`, `description`, `category`, `input_schema`,
  `output_schema`, `meta`). Credentials come only from the environment:
  `ZERO_APP_PASSWORD=user:password`. `--only vendor/*` (repeatable) keeps
  matching names. The lock is rewritten as a whole, sorted by name, with the
  site, the fetch time and a SHA-256 over each ability's canonical schemas.
- **Drift.** `zero doctor --site <url>` lists the site's abilities and reports
  every locked ability the site lacks or whose schema hash changed.
- **Not automatic yet.** `zero dev` could pull from its local site after it
  boots; that needs the dev command to run a build twice and is left for a
  follow-up. Plain REST routes (`/wp-json` index) carry argument schemas but
  no response schemas, so they would type inputs only; not implemented.

## Hooks (PR 2)

`wp-hooks/<hook_name>.ts`, or `wp-hooks/<hook_name>/<file>.ts` for several
handlers of one hook. Each file default-exports its handler; the loader finds
the files, the compiler types the handler from the catalog, and the app plugin
registers it with `add_action`/`add_filter`. One handler shape, one place:
there is no inline form in `defineConfig`.

- Files of one hook register in alphabetical order at priority 10, so they
  run in that order. `export const priority = 20` in a file overrides it.
  Order follows file names rather than mapping to priorities 10, 11, 12...,
  so another plugin's callback at 11 never lands between two of the app's.
- The catalog is a curated, pinned subset generated by
  `scripts/wordpress-catalog.py` from `@wp-hooks/wordpress-core` 1.13.0
  (hook docblocks as JSON) and `php-stubs/wordpress-stubs` 7.1.2 (class
  properties), both pinned by SHA-256. The script also writes the declarations
  in `types/zero/wordpress.d.ts`, and `--check` fails on drift. A hook outside
  the catalog is a located error. There is no untyped escape hatch: an
  untyped hook would pass PHP values nothing checks.
- `WP_Post`, `WP_User` and `WP_Query` parameters are read-only typed views of
  their public properties; `WP_Query` offers `get`/`set`/`is_main_query` only.
- A filter that throws logs the error and returns the value it was given, so
  the page still renders; an action that throws is logged and skipped.
  Re-throwing would white-screen a page view for a cosmetic filter; a silent
  swallow would hide the bug. The log line names the hook.
- Handlers run in WordPress's request, outside any Zero transaction; `db`
  writes each commit on their own. A hook can fire mid-way through another
  plugin's work (`save_post` inside an import), and holding a Zero
  transaction open across it would lock rows that code doesn't know about.
- There is no inline form in `defineConfig`. One place and one handler shape
  keep ordering legible: the directory listing is the registration order.

## Functions (PR 3)

`import { get_option, esc_html } from "php/wordpress"`. A function is admitted
only when its PHP signature maps soundly: no by-reference parameters, no
echoing, no reliance on globals a handler cannot see. Types come from
`php-stubs/wordpress-stubs` at the version matching the booted WordPress,
through the same generator and pin file as the hook catalog. The generator
refuses a by-reference parameter and checks that each allowlisted parameter
list is a prefix of the real signature with only optional parameters after
it.

- **Errors are thrown, not returned.** A `WP_Error` result throws an
  `HttpError` with its code, and its `status` or 422. We rejected a `Result`
  shape: every call site would have to unwrap, and the handler's transaction
  already rolls back on a throw. A function whose result is ambiguous,
  `wp_insert_post` returning `0`, is called with `wp_error: true` so failure
  is always an error.
- **Caches follow the transaction.** WordPress caches options and posts in
  memory, and a rollback can't undo that. Each call records the options and
  posts it writes with the connection, which already cleans them on rollback.
- **Calls lower to `Zero\Wp\Functions::call('<name>', [args])`.** The name
  comes from the allowlist at compile time, so the runtime never calls a name
  that came from data.

## Capability records

Every use of an ability, hook or function is recorded by
`Compiler::use_wordpress(kind, name, span)` and returned as
`Built::wordpress_uses`, so a plugin capability gate can infer what each
module needs.
