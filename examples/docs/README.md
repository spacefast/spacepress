# A docs site on TypedPress

A documentation site where every page is content in WordPress, written as Markdown in this
repository. It uses each content feature once:

| File | What it shows |
| --- | --- |
| [`tp/schema.ts`](tp/schema.ts) | The docs are a hierarchical kind synced from a folder tree of Markdown |
| [`content/docs/`](content/docs) | The docs: a file's name is its slug, its folder its parent, `index.md` the folder's page |
| [`tp/app/docs/[...path]/page.tsx`](tp/app/docs/[...path]/page.tsx) | One page renders every doc, with `nav`, `pager` and `headings` from `"typedpress/content"` |
| [`tp/components/Callout.tsx`](tp/components/Callout.tsx) | Components a Markdown file uses as blocks: `<Callout type="tip">…</Callout>` |
| [`content/docs/guides/install.md`](content/docs/guides/install.md) | Code fences with a title, a marked line and a tab group |
| [`tp/app/about/page.md`](tp/app/about/page.md) | A Markdown page: a WordPress Page the file starts and the site owns |
| [`typedpress.config.ts`](typedpress.config.ts) | `output: "static"`: `typedpress export` writes the site as static files |

`content/docs/roadmap.md` is a draft: it is stored, and no visitor sees it.

## Run it

```sh
typedpress dev examples/docs
typedpress sync examples/docs       # pushes content/docs/ to the site, and pulls editors' changes back
typedpress export examples/docs     # writes the site to tp/dist/static/, with no WordPress to serve it
```

`typedpress export` renders `content/docs/` in a throwaway WordPress and writes each page as
`docs/<path>.html` with its Markdown twin beside it, plus `404.html`, `llms.txt` and the
Interactivity API modules the navigation uses. Any static host serves the folder.

`tests/app_router.rs` (`docs_example_reads_in_the_browser`) builds this example, seeds it as a
publish would, and reads it in Chromium as a visitor: the navigation, previous and next, the table
of contents, a callout, a code group's tabs and both colour schemes, the draft, and the Markdown
version of each page. `docs_example_exports_to_a_static_site` exports it and reads the files from a
plain static server with the same checks.
