# Editable marketing site

A native WordPress/First equivalent of EmDash’s [marketing](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates/marketing) and [marketing-cloudflare](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates/marketing-cloudflare) templates, pinned at `1824902c0c383c052b623528799427b8a5ff75d0`. Both upstream templates have the same content model, sample content and components. Their Node/SQLite/local-storage versus Cloudflare D1/R2 deployment wiring is intentionally replaced by native WordPress and Studio’s SQLite database.

`first.config.ts` owns the page collection, eleven SCF flexible-content layouts, structured SEO group, site identity group, navigation repeater and nested footer repeaters. `wordpress/first-marketing-frontend` is a small WordPress presentation plugin: it reads the live First model under an anonymous viewer, renders saved section order, and uses native attachments. It does not contain a second copy of the content. WordPress admin, SCF, plugins, settings and media library remain available.

| Upstream section | Editable First layout and public behavior                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Hero             | `hero`: headline, announcement/link, two CTAs, image/caption, centered toggle                         |
| Logos            | `logos`: ordered company names or native logo images                                                  |
| Features         | `features`: icon, title and paragraph repeater                                                        |
| Split            | `split`: text/photo, paragraph text, line-separated points, CTA, photo placement                      |
| Stats            | `stats`: ordered value/label repeater                                                                 |
| Testimonials     | `testimonials`: featured first quote, attribution, avatar or initial                                  |
| Pricing          | `pricing`: up to three plans, price/period, description, feature lines, CTA, highlight/badge          |
| FAQ              | `faq`: accessible native disclosure rows and multiline answers                                        |
| Closing CTA      | `cta`: headline, paragraphs, two buttons, optional image                                              |
| Contact          | `contact`: icon/title/description/link cards; email and sales links, not a pretend contact submission |
| Text             | `text`: native rich HTML; `/about` demonstrates this registered but unseeded upstream layout          |

The adapted seed preserves the original Halden home, pricing and contact pages. `/` loads published `home`; `/home` redirects to `/` with the query preserved; `/{slug}` loads a published page or returns 404. Pages without a hero get their page title. Site identity, menus and SEO defaults render from globals. The frontend includes responsive navigation, a light/dark/system selector, skip link, native FAQ disclosures and native WordPress draft previews for editors.

## Run the real acceptance

From the repository root, with Node 22+, npm/npx and the baseline First binary available:

```sh
FIRST_BIN="$PWD/target/debug/first" node --test examples/emdash/marketing/acceptance.test.mjs
```

The test creates a unique temporary project, chooses a free port, starts **native `first dev`/Studio without Docker**, imports the actual seed photos through WordPress media REST, and saves content through core WordPress REST with SCF `acf` fields. It submits the real SCF options form and validation nonce. It then verifies public HTML reloads, section ordering, groups/repeaters/booleans, invalid nested input and unsafe links, anonymous/subscriber permissions, draft isolation, redirects, the full plugins screen, and data/media/credentials/unrelated-plugin persistence after rebuilding the same site. It revokes its own application password, stops its exact site, deletes only that Studio registration and removes its disposable project. The printed `/tmp/first-emdash-marketing-*/evidence` directory retains rendered HTML, results and cleanup receipts.

The first seed needs access to the Unsplash URLs from upstream and to Studio’s package/download sources. Acceptance runs against the real WordPress PHP runtime; it does not establish Cloudflare, D1, R2, PostgreSQL, sandboxed Worker or AI-provider parity. The presentation is an independent equivalent, not a pixel-identical Astro port. SCF text sections use native rich HTML instead of Portable Text. Native previews cover saved drafts; EmDash’s inline editing annotations and signed preview protocol are not reproduced.

## Explore and edit

Create your own isolated project and start native Studio. Choose an unused port:

```sh
project="$(mktemp -d /tmp/first-marketing-demo.XXXXXX)"
cp examples/emdash/marketing/first.config.ts "$project/first.config.ts"
target/debug/first dev "$project" --port 8899 --no-watch
node examples/emdash/marketing/setup.mjs "$project"
```

Open the printed URL and `/pricing`, `/contact`, `/about`. At `/wp-admin/`, use the disposable Studio account `admin` / `first-test-admin`; these are deliberately tracked local-test credentials with no production scope. In **Marketing pages**, edit native SCF sections, add or reorder layouts, and publish. In **Site identity and navigation**, change the wordmark, navigation or footer. Reload the public page to see the saved values. `setup.mjs` seeds only missing pages and an unset global, so rerunning it preserves existing edits and unrelated plugins.

To rebuild after changing the config, stop and restart the **same** project. To refresh the presentation plugin after editing its files, rerun setup. Neither operation deletes site data or uploads:

```sh
target/debug/first dev stop "$project"
target/debug/first dev "$project" --no-watch
node examples/emdash/marketing/setup.mjs "$project"
```

When finished, remove only this exact disposable site:

```sh
target/debug/first dev stop "$project"
npx --yes --package wp-studio@2.1.1 -- studio delete --path "$project/.first/dev/wordpress" --no-files
rm -r "$project"
```

The model and Halden seed are adapted from MIT-licensed EmDash, Copyright 2026 Cloudflare Inc. See `NOTICE` and `LICENSE-MIT`. The frontend is original WordPress rendering; it makes no Cloudflare infrastructure claims.
