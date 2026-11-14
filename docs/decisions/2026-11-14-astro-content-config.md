# An Astro project's content collections are First kinds

Date: 2026-11-14. Status: accepted. Spec: [spec.md](../spec/spec.md) §1 (`content/` synced into
kinds), [external-frontends.md](../spec/external-frontends.md) (Astro interop and migration).

## Problem

An Astro site that adds First already declares its content: `src/content.config.ts` names each
collection, the folder of Markdown it reads (`glob({ pattern, base })`) and the Zod schema of its
front matter. Asking the author to declare the same collections again in `first/` gives two
definitions that drift.

## Decision

**First reads `src/content.config.ts` and makes each `glob()` collection a synced kind.** For

```ts
const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.md" }),
  schema: z.object({ title: z.string(), pubDate: z.coerce.date(), tags: z.array(z.string()).default([]) }),
});
export const collections = { blog };
```

the build has the kind `blog`, as if `first/` held (the builders are imported under private names)

```ts
export const blog = collection(
  { title: text(), pubDate: date(), tags: json<string[]>().default([]), slug: slug(), body: richText().optional() },
  { title: "title", content: "body", hierarchical: true, sync: "src/content/blog/**/*.md", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } },
);
```

- **The file is read, never run.** Astro's modules aren't First's to evaluate, so the reader takes
  the forms Astro's documentation writes: `defineCollection({ loader, schema })` with a `glob()`
  loader, a `z.object()` schema (or a schema function that returns one), and
  `export const collections = { ... }`. Collections with any other loader (a remote one, or
  `firstLoader()` reading a First site) stay Astro's and are skipped.
- **Field mapping.** `z.string()` → `text()` (`.url()` → `url()`, http(s) only; `.email()` →
  `email()`), `z.number()` → `number()` (`.int()` → `integer()`), `z.boolean()` → `boolean()`,
  `z.date()` and `z.coerce.date()` → `date()` (front matter `YYYY-MM-DD`), `z.enum([...])` →
  `select([...])`, `z.array(z.string() | z.number())` → `json<T[]>()` (items unchecked),
  `z.array(z.enum([...]))` → `select([...]).many()`. `.optional()`, `.nullable()`,
  `.default(<literal>)`, `.min()`, `.max()`, `.nonnegative()` and `.positive()` on an `.int()`
  carry over.
- **What it can't map is a build error in `src/content.config.ts`, at the field**, naming it and
  saying what to do: `z.object()`, unions, records, `image()`, `reference()`, transforms and
  refinements, `.positive()` on a number that isn't `.int()`, lists of objects, a default of
  another type than the field, a field name First can't use (not an identifier, or one First adds:
  `slug`, `body`, `parent`, `order`, `status`, `locale`, ...), a collection name First can't use
  (not an identifier, a reserved route like `media`, more than 14 characters), a collection without
  a required `title` (or `name`) string, a loader passed by name, and a glob pattern other than
  `**/*.md` or `*.md`. The author moves such a collection into `first/` and writes it in First's own
  forms there. A collection imported from another file is not read.
- **The files are the sync.** `**/*.md` is a hierarchical kind synced as a folder tree: a file's
  path below the base is its slug and folders are parents, which is how Astro names entries
  (`2024/post.md` is the entry `2024/post`). `*.md` is a flat kind synced from that folder alone,
  its slug following the title. `first sync` keeps the files and the site in step as for any
  synced kind. A pattern that leaves files out (`[^_]*.md`) is refused, as sync reads every file.
- **Access** is the default for a published collection: anyone reads, editors write.
- **One small hook.** The loader writes the kinds as one generated module
  (`first/_astro_content.ts`, never on disk) and loads it like any module under `first/`; checking,
  compiling, capture for a hosted publish and sync are the code every kind goes through.

## Alternatives not taken

- **Running the file with Astro's Zod** to get a JSON Schema: needs Node and Astro installed at
  build time, and the hosted compiler runs neither.
- **A converter that writes `first/` once** (`first migrate --from astro`): two definitions again
  after the first edit. The migration skill covers moving a collection into `first/` by hand when
  the author wants First's richer fields.
