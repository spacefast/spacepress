# A docs site on First

A documentation site where every page is content in WordPress, written as Markdown in this
repository. It uses each content feature once:

| File | What it shows |
| --- | --- |
| [`first/schema.ts`](first/schema.ts) | The docs are a hierarchical kind synced from a folder tree of Markdown |
| [`content/docs/`](content/docs) | The docs: a file's name is its slug, its folder its parent, `index.md` the folder's page |
| [`first/app/docs/[...path]/page.tsx`](first/app/docs/[...path]/page.tsx) | One page renders every doc, with `nav`, `pager` and `headings` from `"first/content"` |
| [`first/components/Callout.tsx`](first/components/Callout.tsx) | Components a Markdown file uses as blocks: `<Callout type="tip">…</Callout>` |
| [`content/docs/guides/install.md`](content/docs/guides/install.md) | Code fences with a title, a marked line and a tab group |
| [`first/app/about/page.md`](first/app/about/page.md) | A Markdown page: a WordPress Page the file starts and the site owns |
| [`first.config.ts`](first.config.ts) | `output: "static"`: `first export` writes the site as static files |

`content/docs/roadmap.md` is a draft: it is stored, and no visitor sees it.

## Run it

```sh
first dev examples/docs
first sync examples/docs       # pushes content/docs/ to the site, and pulls editors' changes back
first export examples/docs     # writes the site to first/dist/static/, with no WordPress to serve it
```

`first export` renders `content/docs/` in a throwaway WordPress and writes each page as
`docs/<path>.html` with its Markdown twin beside it, plus `404.html`, `llms.txt` and the
Interactivity API modules the navigation uses. Any static host serves the folder.

`tests/app_router.rs` (`docs_example_reads_in_the_browser`) builds this example, seeds it as a
publish would, and reads it in Chromium as a visitor: the navigation, previous and next, the table
of contents, a callout, a code group's tabs and both colour schemes, the draft, and the Markdown
version of each page. `docs_example_exports_to_a_static_site` exports it and reads the files from a
plain static server with the same checks.
