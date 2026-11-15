# Consolidation of completed First work

Date: 2026-11-15. Base: `b55dd58d5`.

Completed work was integrated before the separate TypedPress mechanical rename.
The First-built website lives in `www/`; `docs-site/` remains its older docs and
shared browser-compiler asset builder. Old site experiments remain archived.

## Integrated source

| Branch | Commit |
|---|---|
| `first/plugin-followups` | `4c181aa43` |
| `first/site-files-and-styles` | `c830add4d` |
| `fix/schema-version-seal` | `4d34c323f` |
| `fix/review-leftovers` | `eaa7880ea` |
| `perf/compiler-output` | `0914ff561` |
| `t3/evaluate-language-design` | `c7aac2bea` |
| `fix/admin-style-investigation` | `261e20d2a` |
| `typedpress-imports` (proposal only) | `ea1ad9915` |

An independent source review found a deployment-history permission gap. The list
now rejects scoped credentials through the deployment receiver permission check.
A real WordPress HTTP regression proves scoped administrators get 403 while an
unscoped administrator may read the list.

## Deferred work

Original dirty trees were retained. Work in progress is also preserved on GitHub
under `archive/consolidation-20261115/`; the issues link to the snapshot commits.
The snapshot records a point in time, not a claim of completion or correctness.

| Issue | Work |
|---|---|
| [#491](https://github.com/spacefast/zero/issues/491) | Finish the Rust and oxc dependency upgrade and bundler compatibility investigation |
| [#492](https://github.com/spacefast/zero/issues/492) | Finish development server public address and host support |
| [#493](https://github.com/spacefast/zero/issues/493) | Fix WordPress main-query status for hierarchical app content routes |
| [#494](https://github.com/spacefast/zero/issues/494) | Make app stylesheet ownership explicit and serve public files before WordPress initialization |
| [#495](https://github.com/spacefast/zero/issues/495) | Finish API-reference static route parameters |
| [#496](https://github.com/spacefast/zero/issues/496) | Finish generated PHP builtin qualification and runtime installation-check optimization |
| [#497](https://github.com/spacefast/zero/issues/497) | Use native WordPress posts and finish WordPress theme template integration |
| [#498](https://github.com/spacefast/zero/issues/498) | Remove custom table revisions according to the agreed design |
| [#499](https://github.com/spacefast/zero/issues/499) | Finish website comments and latest-posts additions |
| [#500](https://github.com/spacefast/zero/issues/500) | Make www builds and initial content reproducible in CI |
| [#501](https://github.com/spacefast/zero/issues/501) | Qualify www plugin deployment on Pressable and reuse login credentials for content sync |
| [#502](https://github.com/spacefast/zero/issues/502) | Complete the typedpress module layout, browser islands and authoring-tool design |
| [#503](https://github.com/spacefast/zero/issues/503) | Spacefast host adapter and dynamic website qualification |

The inventory used `git worktree list --porcelain` for registered worktrees, then
`git status --porcelain --untracked-files=all` to select dirty trees. Safety commits
were written through temporary indexes; original files and indexes were untouched.
Old branch-ahead counts were not treated as missing features: main already contains
the earlier integration in `2371ad890`.

No staging or production deployment is part of this consolidation.
