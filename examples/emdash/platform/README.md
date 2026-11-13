# Platform journal

An authored First application for the editorial seams in the official EmDash
platform demos. It uses **native WordPress Studio, PHP, SQLite, SCF, Polylang,
Action Scheduler and local disk storage**. It never starts Docker.

The journal has an anonymous list, story detail, author credit, cover image,
structured sections, links and English/French navigation. WordPress and First
admin remain available. Its acceptance journey creates real content through
native WordPress REST/SCF, edits through First, and checks both surfaces and the
stored WordPress state.

## Run the acceptance journey

From the repository root, with Node 22+ and npm installed:

```sh
FIRST_BIN="$PWD/target/debug/first" node --test examples/emdash/platform/acceptance.test.mjs
```

Run `cargo build` first so the binary embeds the current compiler and PHP runtime.
The browser journey uses the shared example dependencies:

```sh
npm --prefix examples/emdash ci
npm --prefix examples/emdash exec -- playwright install chromium
```

The runner creates a unique `/tmp/first-emdash-platform-*` project, asks the OS for
a free port, starts `first dev --no-watch`, and owns that project's `.first/dev`
receipt, database, uploads and Studio registration. It also starts an actual
local HTTP webhook receiver on a second OS-assigned port. Requests go through
the real runtime; there are no mocked WordPress, storage, job or webhook calls.

It prints the evidence directory at exit. Set `PLATFORM_EVIDENCE=/tmp/<unique-name>`
to choose it. Evidence includes command/HTTP results, native SCF and First values,
original/transformed PNG bytes, synchronized Markdown, browser screenshots,
journey outcomes and `cleanup.json`. App passwords are omitted from recorded
commands. The temporary credentials and webhook secret are dedicated to this
isolated test site; they have no access to any other resource.
Tracking these disposable local credentials is intentional; they must never be
reused for personal accounts, deployed sites, or production data.

Every run stops **its exact project**, deletes **its exact Studio registration**
with `--path ... --no-files`, then deletes its own temporary files. Evidence is
retained. Cleanup failures fail the test and leave the site's files available
for inspection. The runner does not stage, commit or change the shared checkout,
and sync always passes `--no-commit`.

A nonzero exit is a qualification failure. Independent journeys continue so a
single field defect does not hide the rest of the report. Read `results.json`
and the assertions; passing unrelated journeys does not waive a failing one.

## Run the journal interactively

Keep generated state outside this checkout. For example, from the repository root:

```sh
platform_root=$(mktemp -d /tmp/first-platform-manual.XXXXXX)
platform_project="$platform_root/app"
mkdir "$platform_project"
cp examples/emdash/platform/first.config.ts "$platform_project/"
cp -R examples/emdash/platform/public examples/emdash/platform/content "$platform_project/"
platform_port=$(node --input-type=module -e 'import net from "node:net"; const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
./target/debug/first dev "$platform_project" --port "$platform_port" --no-watch
```

Use the printed WordPress URL and initial local credentials. The public journal is
`/wp-content/plugins/first-app-platform/public/index.html`; `/wp-admin/` includes
native content editing, media, plugins and settings; `/wp-admin/new/` is the First
surface. Create a writer, then a story. Save it as a draft, add its native SCF
fields, and publish when ready. In First, create the French story with `locale:
"fr"` and `translationOf` set to the English ID. English/French titles and bodies
translate independently; the other fields synchronize through Polylang.

The config's optional webhook integration expects `PLATFORM_HOOK_URL` and
`PLATFORM_HOOK_SECRET` as runtime constants/environment variables. Before creating
tasks, point these at a real receiver you control:

```sh
./target/debug/first wp --site "$platform_project" config set PLATFORM_HOOK_URL https://your-receiver.example/events
./target/debug/first wp --site "$platform_project" config set PLATFORM_HOOK_SECRET your-disposable-test-secret
./target/debug/first wp --site "$platform_project" action-scheduler run --hooks=first_job
```

The automated command configures its own receiver. Its inbound `receive` action
requires the hex HMAC-SHA256 of the exact request body in `first-signature`.
Outbound webhooks use the separate timestamped `t=...,v1=...` signature format.

When finished with the interactive site:

```sh
./target/debug/first dev stop "$platform_project"
npx --yes --package wp-studio@2.1.1 -- studio delete --path "$platform_project/.first/dev/wordpress" --no-files
rm -r "$platform_root"
```

These commands are intentionally scoped to the project you just created.

## Pinned upstream and behavior map

All links below point to EmDash commit
`1824902c0c383c052b623528799427b8a5ff75d0`. This is an independently authored
First example, not a copied provider adapter. The upstream MIT notice is retained
in [UPSTREAM-LICENSE-MIT](./UPSTREAM-LICENSE-MIT).

| Official example / guide | Actual behavior inspected | First equivalent and qualification boundary |
| --- | --- | --- |
| [demos/cloudflare](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/demos/cloudflare) | D1 read sessions, R2 media, Cloudflare Access role provisioning; Images/Stream; AI Search; forms; trusted and sandboxed plugins; edge caching; blog pages, locale routing, search/RSS | Journal publishing, roles, relations, languages, local media transforms and signed webhook effects run on WordPress. **No D1/R2/Access/Images/Stream/AI Search/Worker sandbox/cache qualification.** The `als-test`, `sandbox-test` and `sandbox-plugin-test` pages exercise Worker-specific execution and cannot be proven by PHP. Template/plugin workers own their respective product journeys. |
| [demos/postgres](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/demos/postgres) | Node standalone server, PostgreSQL adapter, post/page archives and details, search, categories/tags and RSS | Actual SQL-backed tasks relate to WordPress post-backed stories; WP-CLI independently observes the saved rows. Studio uses SQLite, **not PostgreSQL**. This proves no PG transaction, index, migration or concurrency behavior. |
| [demos/playground](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/demos/playground) | Durable Object-backed disposable database and storage, seeded media, auth/setup bypass through playground middleware, MCP disabled | Each acceptance run owns a disposable Studio site, registration and data. WordPress authentication remains enabled. **No shared-browser session isolation, auth bypass, DO lifecycle or reset parity.** |
| [demos/preview](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/demos/preview) | Separate Worker renders source-site snapshots in a preview Durable Object; `sign-url.ts` signs source and expiration | Authenticated draft reads and native revisions are tested. **No source-site snapshot fetch, signed public preview URL, expiry enforcement or isolated preview Worker claim.** |
| [Create a Blog](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/create-a-blog.mdx), [Working with content](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/working-with-content.mdx) | Draft → publish, title/body/slug/image, revisions, author credit, public detail and list | Native SCF create → First read → First publish → anonymous public HTML; native edits and revision restore. Categories/tags, full-text search, comments, widgets and RSS belong to the blog/template example, not this platform journey. |
| [Relations](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/relations.mdx) | Named relation owns ordered links, pickers on either end, translation-group identity and cardinality constraints; changes can stage in draft | A native post-object writer reference and a SQL foreign key task reference resolve in both directions through First. **No equivalent claim for ordered many-to-many links, two-ended picker editing, configurable cardinality or staged link publication.** First defines this schema in code. |
| [Blocks](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/blocks.mdx), [Page layouts](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/page-layouts.mdx) | Structured content/layout editing and rendering | Real SCF group, repeater and flexible-content layout saves; Gutenberg body; JSON `{}`, `[]`, `false`, `null`; public quote rendering. No Portable Text/block-registry compatibility claim. |
| [Authentication](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/authentication.mdx) | Passkeys/login providers; separate Cloudflare Access production mode | Real WP application passwords and browser login; editor/subscriber/anonymous restrictions; native and First field masking. No OAuth, passkey, external IdP or Access qualification. |
| [Internationalization](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/internationalization.mdx) | Locale content and public routing | Polylang's own language/group APIs confirm English/French identity; a native French edit updates shared English postmeta; public language navigation renders translated titles. No Astro fallback/middleware parity claim. |
| [Media Library](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/media-library.mdx) | Upload/select files, native metadata, local/provider storage and transforms | Actual PNG bytes uploaded to WordPress, original served byte-for-byte, 120×120 crop served and hashed against the file on disk, image selected on story and rendered publicly. No external provider, video, media-folder or AI transform claim. |
| [Preview](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/preview.mdx) | Matching-entry expiring signed preview token; ordinary requests see published entry | Draft invisibility and authenticated revision restore are qualified. **Shareable signed draft previews are not implemented here.** WordPress revision restore and status changes differ from EmDash's simultaneous staged/live versions. |
| [Backups](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/backups.mdx), [Site transfer](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/site-transfer.mdx) | Complete recovery point, media/key backups; validated resumable cross-database site package preserving editorial history | Additive migration, rejected destructive migration, explicit destructive migration and persistent restart preserve remaining data/users/settings/uploads/unrelated plugins. Markdown CLI sync pushes a draft and pulls a native edit. **Neither restart nor content sync proves raw backup recovery, complete site-package import, media transfer or cross-provider migration.** |

Hooks/jobs/webhooks are tested as an actual app workflow: creating a task trims
its label, enqueues processing after save, updates its persisted SQL row through
Action Scheduler, and delivers signed JSON over HTTP. A valid inbound signature
persists a delivery record; an invalid signature is rejected. The receiver is a
local test endpoint, not an AWS/Cloudflare provider substitute.

## Existing proof owners and review choices

This journey adds the native Studio/application boundary. Operator matrices,
field-policy edge cases, sync conflict algorithms, image crop semantics and
identity protocol cases stay with their existing lower-level owners:
`tests/wp/{editor,fields,postmeta,core-access,locales,media,jobs,sync}.test.ts`,
`tests/php/{webhooks,sync,images}_test.php`, and
`scripts/dev/acceptance.test.mjs`. Those suites are reference owners; this README
does not claim they were rerun as part of this example's qualification.

The application uses single references and one representative SQL relation,
English/French and one representative image transform. It intentionally avoids
repeating the lower-level matrices. The frontend is authored for this journal;
it is not a pixel copy of EmDash's Astro templates. Evidence reports real failures
without changing assertions to match a defect.
