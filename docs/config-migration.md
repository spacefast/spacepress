# Migrate a CMS config

`zero migrate config` imports declarative schemas from EmDash, Payload and
Sanity. It writes a new `zero.config.ts`; it never overwrites the source or an
existing destination.

```sh
zero migrate config --from payload payload.config.ts --out migrated/zero.config.ts
zero build migrated
```

Use `--from emdash`, `payload` or `sanity`. Input can be a JSON schema
export or a single TypeScript module with a default export. EmDash uses its
version `"1"` seed format; Payload uses its config's declarative object; Sanity
uses `schema.types`.
Runnable input examples live in `tests/fixtures/config-migrate`.

The importer parses TypeScript with Rust. It recognizes named imports of
Payload's `buildConfig`, Sanity's `defineConfig`/`defineType`/`defineField`/
`defineArrayMember`. Aliases, constants, literal objects/arrays and type
assertions work. CMS packages are never loaded. A JSON export must retain the
source declarations: `JSON.stringify` can erase callbacks before Zero sees them,
so a serialized executable config does not establish compatibility. Relative modules, spreads,
computed properties, executable statements and arbitrary helper calls require
a declarative export or a manual port. JSON and TypeScript duplicate keys fail.

## Supported mappings

| Source | Fields supported by this importer |
| --- | --- |
| EmDash | `string`, `text`, `number`, `integer`, `boolean`, `datetime`, `json` |
| Payload | `text`, `textarea`, `email`, `number`, `checkbox`, `date`, `json`, string-valued `select` (including `hasMany`) |
| Sanity | `string`, `text`, `number`, `boolean`, `datetime`; literal `initialValue`; `Rule => Rule.required()` |

Required fields (including nonempty required Payload text/multi-selects and EmDash/Sanity strings),
scalar defaults, supported bounds, uniqueness and collection
labels are carried where declared. Payload's automatic `createdAt`/`updatedAt`
are generated unless `timestamps: false`. Field editor labels/descriptions are
reported for manual admin mapping. Payload's plural collection label is carried;
the loss of a distinct singular label is reported. Sanity's project/dataset
metadata and EmDash's seed metadata are identified in the report, not deployed.

EmDash integers keep Zod's safe-integer range (±9007199254740991) on top of any
declared bounds. EmDash booleans become `boolean()`, which accepts only
`true`/`false`; EmDash also accepted its stored `0`/`1`, so each boolean field is
reported for client review.

Required Payload checkboxes without an explicit default receive `false`, matching
Payload's sanitizer. Optional checkboxes keep their declared default or absence.
Required Payload JSON values must be JavaScript-truthy: `false`, `0`, `""` and
null are rejected; empty arrays and objects are allowed. Required EmDash JSON
values reject only `""`, as EmDash does for every required field. Payload text bounds use
generated validators that count UTF-16 code units, so a supplementary Unicode
character counts as two. A Payload `text` or `textarea` without `maxLength`
receives Payload's default `defaultMaxTextLength` of 40000. These validators preserve the source constraint rather
than using Zero's Unicode-character count for text `.max()`.

Field labels are preserved with `.ui({ label })` for the supported scalar
mappings. Sanity field `title`/`description` map to
`label`/`help`. Payload `admin.description`, `admin.placeholder` and integer
percentage `admin.width` (for example `"50%"`) map to the same presentation
metadata. Each mapped property appears in the report. Other admin options,
including read-only behavior, are refused rather than discarded. This does not
add support for nested fields or executable admin components.

A required text field named `title` enables a WordPress custom post type with
the target's draft/revision behavior. Otherwise the imported collection uses a
SQL table (`table()` in `tables`). The report calls out this storage choice and the
need to review publishing behavior. Import does not adopt existing WordPress
post types.

EmDash URL fields are refused because their relative, `mailto:` and `tel:` URL
policy differs from Zero's absolute HTTP(S) URL field. Sanity URI fields are also
refused: Zero's URL validator cannot preserve Sanity's scheme/credential and
empty-value policy. Payload email fields keep Payload's own address pattern on
top of Zero's `email()` check, so quoted local parts and `[127.0.0.1]` address
literals stay rejected. Zero's `email()` also applies PHP's address check, which
rejects a local part over 64 characters or a label over 63 that Payload accepted;
each Payload email field is reported for that review. Optional Payload email fields also carry a specific
review entry because Zero rejects empty strings that Payload accepts;
null/absence remain nullable. Port or normalize that behavior before deployment.

Payload `date` fields become `timestamp()`, which accepts ISO 8601 text and
epoch milliseconds. Payload's `Date.parse` check also accepted free-form dates
such as `Jan 1 2026`; the report flags each date field so clients can send ISO.

EmDash and Sanity `datetime` fields become `timestamp()`, which accepts exactly
`YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM[:SS[.fraction]]` with `Z` or `±HH:MM`, with
real calendar and clock values (no February 30, no `24:00`) and UTC years
0000-9999, or epoch milliseconds. It stores UTC, so values sort and filter as
times; Zero keeps milliseconds (finer fractions are truncated) and WordPress
post-backed collections keep whole seconds. Both sources stored the text as
given. Each field's report states the grammar and what changed: EmDash refused
a date alone and epoch milliseconds; Sanity accepted many other ISO 8601
spellings (week, ordinal, reduced and compact forms, expanded years, impossible
dates, no timezone, and more), which are all refused now.

JSON defaults preserve objects and arrays as distinct shapes, including empty
objects, empty arrays, and nested objects keyed `"0"`, `"1"`, ... in order.
The importer, compiled handlers and storage round trip retain those objects;
numeric property names alone do not cause a default to be refused.

Unspecified REST permissions are emitted as `false` for read/create/update/
delete, rather than inheriting Zero's public-read default. Literal Payload
boolean access rules override the corresponding denials. Configure access before deployment. This is a reported change, not a
claim that the source CMS's authentication model has been migrated.

## Reports and refusal

The command prints JSON to stdout with `version: 1`, `source`, `status`,
`entries` and `errors`. Each entry contains an RFC 6901 `pointer`, an `outcome`
(`mapped`, `metadata` or `review`) and a `reason`. `written` means the config
compiled; review entries still require source and target behavior to be
compared. It does not mean a complete app was migrated.
Pointers address the expanded default-export object, including references to
constants. File-level errors and invalid unused declarations use the root pointer
`""`; their reason names the affected binding when applicable.

An unsupported construct exits 1 with `status: "refused"`, a pointer and reason.
No config is published. The report may contain mappings completed before the
first refusal. Invalid CLI arguments exit 2. Destination collisions also refuse;
there is no overwrite flag. The compiler validates the generated configuration
in a temporary directory before publication. Migration does not acquire plugins,
write SQL migrations to the destination or execute PHP.

The supported subset rejects unknown keys rather than ignoring them. In
particular, these require a separate port:

- Access/validation/hook callbacks, except the explicit Sanity required rule.
- Rich text (Portable Text and Lexical), CMS assets and references, nested/custom
  schemas, globals, localization and custom plugins.
- EmDash documents, menus, taxonomies, settings, routes and other seed features.

For example, a Payload config with hooks fails instead of producing a config
with those hooks removed. Keep the original application intact until its
behavior is implemented and validated in the new runtime.

## Config import versus application migration

This command does not move documents, uploads, string IDs, user identities,
sessions, secrets, URLs or browser clients. It does not convert existing PHP or
JavaScript plugins into Rust declarations.

Tests are owned by `tests/config_migrate.rs`. They run the actual command for
all four formats, build its output and load the emitted PHP schema. The
imported apps also boot on a WordPress-on-SQLite site to verify defaults,
validation and REST access. Refusal tests cover
callbacks, unknown features, dynamic code, duplicate names, invalid generated
defaults and unchanged destinations.
