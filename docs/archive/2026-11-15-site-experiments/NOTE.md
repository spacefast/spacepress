# Site experiments archived on 2026-11-15

Three earlier attempts at the TypedPress/First website were replaced on 2026-11-15. This branch
and the archive files listed below keep them so none can be lost.

- Nothing on this branch is meant to be merged. Do not open a pull request from it.
- No CI should run on this branch. No workflow in `.github/workflows` runs on a push to an
  `archive/` branch (they run on pull requests, pushes to `main`, `v*` tags, a schedule, and one
  temporary push trigger for the branch `first/wordpress-ahead-issue`).
- The published Space <https://typedpress-guide.space.fast/> stays up as it is. It was built from
  experiment B and is not updated from the new site.

## What replaced all three

The First app in `website/` on the local branch `t3/evaluate-language-design`, at `7643b39e1` at the
time of writing (worktree `/home/batuhan/.t3/worktrees/zero-rs/t3-184bbf7e-2949255182de2126`). That
branch was not on `origin` at the time of writing. Its home page is the guide, every example on it
can be opened for editing, and `/play` is the playground; one component, `<tp-play>`
(`website/src/play.js`), does all three.

## The three experiments

| | Experiment | What it was | Where it lives now | Replaced by |
| --- | --- | --- | --- | --- |
| A | tp-site wrapper | A First app that wrapped the built static guide (B's build output). `tools/to-first.py` turned each built page into a First route (`/` and `/play`): the page body became one trusted `<Html>` literal in a `page.tsx`, the page's stylesheet a scoped `.css` file, and the scripts, compiler and example files went to `public/`. It ran with `first dev` on port 8943; an earlier copy in `/dev/shm/tp-site` ran on port 8942. It was never a git repository. | The four hand-written files are in `tp-site/` beside this note (table below). The whole folder, including the generated 1.4 MB `first/app/page.tsx`, `public/` and the local WordPress in `.first/dev`, is in the archive `tp-site.tar.gz`; the earlier copy is in `tp-site-shm.tar.gz` (archive table below). | `website/` (above), which is written as a First app and is not a wrapper around built HTML. |
| B | Static guide + playground | The source of the published Space <https://typedpress-guide.space.fast/>: one HTML page that describes the whole framework and a playground page that compiles an app in the browser and runs it in WordPress Playground. Standalone HTML built by `build.mjs` with `@pierre/diffs` and `@pierre/trees`. | Commit `a8b3fe452` (`a8b3fe452db62d5410d8de1d3a8de23838d98d69`), the parent of the commit that adds this note, one commit on top of `main` at `b55dd58d5`: 61 files under `docs/typedpress-guide-src/`, plus `docs/design-typedpress-app.html` and a `.gitignore` line. Its build output `docs/typedpress-guide/` (28 MB, git-ignored) is in the archive `typedpress-guide-build.tar.gz` (archive table below). | `website/` (above). The guide and playground sources moved into `website/src`. |
| C | Astro playground | A playground page inside the Astro (Blume) docs site: edits one example file and shows what the compiler makes of it, with the same browser compiler. | In `main`'s history at `b55dd58d5`, and so also on this branch: `docs-site/pages/playground.astro`, `docs-site/lib/playground.ts`, `docs-site/tests/playground/` (`boot.test.ts`, `edited.test.ts`, `helpers.ts`). Last changed in `3131f1404`. It was still on `main` at the time of writing; a later pull request deletes it. | `website/` (above): `/play` and the editable examples on the home page. |

## Files copied from tp-site (experiment A)

| File here | Path in the tp-site folder | What it is |
| --- | --- | --- |
| `tp-site/to-first.py` | `tools/to-first.py` | The only hand-written logic: built guide in, First app out. Run as `python3 -I to-first.py <built-guide-dir> <first-project-dir>`. |
| `tp-site/first.config.ts` | `first.config.ts` | The First config: `name: "site"`, `output: "static"`. |
| `tp-site/layout.tsx` | `first/app/layout.tsx` | The root layout; written by `to-first.py`. |
| `tp-site/play-page.tsx` | `first/app/play/page.tsx` | The `/play` route as `to-first.py` wrote it; shows the shape of a generated page. |

Not copied here, but in `tp-site.tar.gz`: `first/app/page.tsx` (1.4 MB, generated), `public/`
(17 MB, generated) and `.first/` (132 MB, the local WordPress).

## Archive files

All three are on the dev box in `/home/batuhan/projects/zero-safety-2026-11-14/site-copies-2026-11-15/`.
They are not in git. Each was made with `tar -I pigz -cf` from the folder's parent directory, so it
extracts to one top-level folder. Each was verified by extracting it to a temporary directory and
running `diff -r --no-dereference` against the original (no differences) and comparing file counts.

| Archive | Made from | Files | Size in bytes | sha256 |
| --- | --- | --- | --- | --- |
| `tp-site.tar.gz` | `/home/batuhan/projects/first-wt/tp-site` (experiment A) | 14,962 | 128,399,772 | `f2c6499f48efc0149133d5ea798ea9ca2f4ccb81deb952aad9246bf104260b6e` |
| `tp-site-shm.tar.gz` | `/dev/shm/tp-site` (experiment A, earlier copy) | 13,487 | 88,948,318 | `21ce1a574a7ce3594eb69c41fcd81b404bfaf61c5accbdb40529e7443d9e2519` |
| `typedpress-guide-build.tar.gz` | `docs/typedpress-guide/` in the worktree named above (experiment B's build output) | 505 | 12,299,108 | `bfa4ba7f9f9273ea015bc01f8dc2e7f220686cb316b975a2adaceb19c66b1127` |

To check an archive: `sha256sum <file>` must print the value in the table. To restore one:
`tar -I pigz -xf <file> -C <empty directory>`.

The original folder `/home/batuhan/projects/first-wt/tp-site` is meant to be deleted once it is
archived; `/dev/shm/tp-site` is in memory and is lost when the machine restarts. Rely on the
archives, not on either folder. `~/.studio/cli.json` still lists both as sites named
"First tp-site" (ports 8943 and 8942); those entries are stale once the folders are gone.
