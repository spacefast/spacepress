// The tour: a walk through the committed examples, one idea per stop. Each stop names lines of a
// config file and lines of what `first build` makes of them, by anchors (src/lib/excerpt.ts), so the
// tour follows the examples and the compiler as they change, and breaks the build if a stop no longer
// matches rather than showing stale text.
import type { Anchors } from "../lib/excerpt.ts";
import type { ExampleName } from "../lib/examples.ts";

export type Artifact = "schema.php" | "functions.php" | "migration" | "types.ts" | "schema.ts" | "db.d.ts";

export interface Pane {
  /** A source file of the example, or an artifact the compiler produced from it. */
  file: string | { artifact: Artifact };
  lines: Anchors;
}

export interface Stop {
  slug: string;
  title: string;
  /** Short paragraphs, plain text. */
  prose: string[];
  config: Pane;
  /** Other source lines the config excerpt leans on (a helper, an imported file). */
  inputs?: Pane[];
  outputs: Pane[];
}

export interface Tour {
  example: ExampleName;
  title: string;
  intro: string[];
  stops: Stop[];
}

export const tours: Tour[] = [
  {
    example: "pantry",
    title: "The pantry: tables, hooks, actions and a job",
    intro: [
      "examples/pantry is the quick start: three tables, a hook that cleans up a row before it is stored, two actions and a background job. This page shows each piece of its first.config.ts next to what first build turned it into.",
      "Everything on the right was produced from the file on the left by the same compiler that runs in this browser; nothing here is pasted by hand.",
    ],
    stops: [
      {
        slug: "a-table",
        title: "A table becomes SQL",
        prose: [
          "A table holds app data in SQL; collections hold editorial content in WordPress. Every kind has an integer `id`. Fields are required unless `.optional()`, a `default()` fills an omitted value, and `select()`'s options are recorded in `schema.php` for the runtime to check on every write.",
          "The first build writes `0001_init.sql`; the next build diffs the schema against the committed snapshot and writes only what changed.",
        ],
        config: { file: "first.config.ts", lines: { from: 'export const locations = table(', to: "}));" } },
        outputs: [
          { file: { artifact: "migration" }, lines: { from: "CREATE TABLE `{prefix}first_locations`", to: "ENGINE=InnoDB" } },
          { file: { artifact: "schema.php" }, lines: { from: "'kind' => ['type' => 'text', 'notNull' => true, 'enum' => ['fridge', 'freezer', 'pantry']", to: "'kind' => ['type' => 'text', 'notNull' => true, 'enum' => ['fridge', 'freezer', 'pantry']" } },
        ],
      },
      {
        slug: "composition",
        title: "Composition is plain TypeScript",
        prose: [
          "The config is evaluated at build time by First's own evaluator, so helpers, factories and spreads work as you expect: `named()` adds a `name` column to any set of columns, and `...timestamps` comes from another file.",
          "The evaluator has no file system and no clock. What it produces is the schema as plain data, which is all the next steps need.",
        ],
        config: { file: "first.config.ts", lines: { from: 'export const items = table(', to: "}));" } },
        inputs: [
          { file: "first.config.ts", lines: { from: "const named =", to: "const named =" } },
          { file: "first/lib/fields.ts", lines: { from: "export const timestamps", toLine: "};" } },
        ],
        outputs: [{ file: { artifact: "migration" }, lines: { from: "CREATE TABLE `{prefix}first_items`", to: "ENGINE=InnoDB" } }],
      },
      {
        slug: "a-hook",
        title: "A hook is compiled to PHP",
        prose: [
          "Hooks run inside WordPress, so they cannot be JavaScript at runtime. First compiles them: string methods become `\\First\\Js` helpers where JavaScript and PHP differ, `throw new HttpError` becomes the runtime's exception, and the `slugify` helper imported from first/lib/fields.ts comes along as a PHP function.",
          "Where no sound translation exists, the build fails with a location and a suggestion rather than guessing.",
        ],
        config: { file: "first.config.ts", lines: { from: "beforeCreate(data) {", to: "afterUpdate: restock," } },
        outputs: [
          { file: { artifact: "functions.php" }, lines: { from: "function items__beforeCreate", toLine: "}" } },
          { file: { artifact: "functions.php" }, lines: { from: "function slugify(", toLine: "}" } },
          { file: { artifact: "schema.php" }, lines: { from: "'hooks' => ['beforeCreate' => 'items__beforeCreate'", to: "items__afterUpdate']," } },
        ],
      },
      {
        slug: "an-action",
        title: "An action is an endpoint",
        prose: [
          "An action takes typed input and returns whatever its handler returns. It is served at `/__first/api/v1/actions/consume`, its input is validated against the declared columns, and `access` decides who may call it.",
          "The typed client gets an `Actions` entry for it, so `first.actions.consume({ itemId })` is checked in your editor.",
        ],
        config: { file: "first.config.ts", lines: { from: "consume: action({", to: "    })," } },
        outputs: [
          { file: { artifact: "functions.php" }, lines: { from: "function action__consume", toLine: "}" } },
          { file: { artifact: "schema.php" }, lines: { from: "'consume' => [", to: "'access' => ['role' => 'editor']," } },
          { file: { artifact: "types.ts" }, lines: { from: "export interface ConsumeInput", to: "export type ConsumeOutput" } },
        ],
      },
      {
        slug: "a-job",
        title: "A job runs after the request",
        prose: [
          "`jobs.notifyLowStock.enqueue()` inside a hook queues work that runs after the request's write commits, on Action Scheduler. Retries and a key for deduplication are declared, not coded.",
          "The handler is compiled like a hook; the queue, retries and delivery are the runtime's.",
        ],
        config: { file: "first.config.ts", lines: { from: "notifyLowStock: job({", to: "    })," } },
        outputs: [
          { file: { artifact: "functions.php" }, lines: { from: "function job__notifyLowStock", toLine: "}" } },
          { file: { artifact: "schema.php" }, lines: { from: "'notifyLowStock' => ['input' => [", to: "'itemId' => ['type' => 'integer', 'notNull' => true]," } },
        ],
      },
      {
        slug: "the-client",
        title: "A typed client for any frontend",
        prose: [
          "`first/_generated/client/types.ts` is generated from the schema: a row type, an insert type, a patch type and a filter type per collection, plus the relations that `with` can load: each `ref()` field and the reverse list its target gets.",
          "`first/_generated/client/index.ts` is the runtime half, copied from the repository with the generated types beside it.",
        ],
        config: { file: "first.config.ts", lines: { from: "export const shoppingList = table({", to: "itemId: ref(items)" } },
        outputs: [
          { file: { artifact: "types.ts" }, lines: { from: "export interface Item {", to: "export interface ItemWith" } },
          { file: { artifact: "types.ts" }, lines: { from: "export interface Collections {", toLine: "}" } },
        ],
      },
    ],
  },
  {
    example: "blog",
    title: "The blog: access, sync, members, media, jobs and translations",
    intro: [
      "examples/blog is the CMS tour: every feature a content site needs, in one config. The stops below pick out the parts that go beyond tables and hooks.",
    ],
    stops: [
      {
        slug: "field-access",
        title: "Access rules, down to a field",
        prose: [
          "Collection access can be a role or a function of the request; a function may return `true` or a filter, so readers see published posts only while staff see everything. A single column can have its own rule: an author's email is read by editors only.",
          "Access functions compile to PHP and run on every request; filters become part of the query.",
        ],
        config: { file: "first.config.ts", lines: { from: "read: (ctx) => [\"author\", \"editor\", \"admin\"].includes(ctx.user?.role ?? \"\") ? true : { status: \"published\" },", to: "delete: \"editor\"," } },
        outputs: [
          { file: { artifact: "schema.php" }, lines: { from: "'email' => ['type' => 'email', 'notNull' => true, 'unique' => true, 'rules' => ['max' => 191], 'access'", to: "'access'" } },
          { file: { artifact: "functions.php" }, lines: { from: "function posts__access__read", toLine: "}" } },
        ],
      },
      {
        slug: "sync",
        title: "Posts as Markdown files",
        prose: [
          "`sync: \"content/posts/*.md\"` makes a collection two-way: `first sync` sends committed Markdown to the site and pulls edits back as files, with a three-way merge when both sides changed.",
          "The schema records the designation; the sync command and the runtime's merge do the rest.",
        ],
        config: { file: "first.config.ts", lines: { from: 'sync: "content/posts/*.md"', to: 'sync: "content/posts/*.md"' } },
        outputs: [{ file: { artifact: "schema.php" }, lines: { from: "'sync' => ['dir' =>", to: "'sync' => ['dir' =>" } }],
      },
      {
        slug: "members",
        title: "Readers who sign in",
        prose: [
          "`userProjection()` in `users` projects native WordPress accounts: the first-identity plugin provides the sign-in screens, sessions, passkeys and MFA. In hooks and access rules `ctx.user` is the signed-in identity (`id`, `name`, `role`); the member's own row comes from `/me`.",
          "`\"self\"` is the rule for a member's own row: here both `read` and `update` are `\"self\"`, so a member reads and edits their row and nobody else's. An operation without a rule takes the default: reads are open to anyone, writes need an editor.",
        ],
        config: { file: "first.config.ts", lines: { from: 'userProjection(', to: 'access: { read: "self", update: "self"' } },
        outputs: [{ file: { artifact: "schema.php" }, lines: { from: "'auth' => ['collection' => 'members'", to: "'auth' => ['collection' => 'members'" } }],
      },
      {
        slug: "media-and-files",
        title: "Images with sizes, files behind a signed link",
        prose: [
          "`media()` columns reference the WordPress media library; `media.sizes` declares the crops the runtime generates. `file(bucket)` columns point at private files that are downloaded through a signed link, with their own access rules.",
        ],
        config: { file: "first.config.ts", lines: { from: "media: { sizes:", to: "media: { sizes:" } },
        outputs: [
          { file: { artifact: "schema.php" }, lines: { from: "'media' => ['sizes' => ['card'", to: "'media' => ['sizes' => ['card'" } },
          { file: { artifact: "schema.php" }, lines: { from: "'decks' => ['accept'", to: "'decks' => ['accept'" } },
        ],
      },
      {
        slug: "webhooks",
        title: "Webhooks, declared",
        prose: [
          "Every change to posts is POSTed, signed with a shared secret, to a URL read from the environment at runtime. Delivery retries on failure. `env()` keeps secrets out of the config and out of the build.",
        ],
        config: { file: "first.config.ts", lines: { from: "webhooks: [", to: "webhooks: [" } },
        outputs: [{ file: { artifact: "schema.php" }, lines: { from: "'webhooks' => [[", to: "'webhooks' => [[" } }],
      },
      {
        slug: "translations",
        title: "Translated fields",
        prose: [
          "`locales` names the languages; `.localized()` marks the columns that differ per language. The other declared columns are shared by a post's translations; each translation keeps its own slug, status and dates. The migration, the REST API and the client all know which is which.",
        ],
        config: { file: "first.config.ts", lines: { from: "locales: {", to: "locales: {" } },
        outputs: [
          { file: { artifact: "schema.php" }, lines: { from: "'locales' => ['default'", to: "'locales' => ['default'" } },
          { file: { artifact: "types.ts" }, lines: { from: "export type Locale =", to: "export type Locale =" } },
        ],
      },
    ],
  },
];
