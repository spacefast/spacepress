# Astro → SpacePress, construct by construct

| Astro | SpacePress | |
| --- | --- | --- |
| `defineCollection({ loader: glob(...), schema: z.object(...) })` | kept: read as a synced kind | `spacepress check` says which fields don't map |
| `z.string()`, `z.number()`, `z.boolean()`, `z.coerce.date()`, `z.enum()`, `z.array(z.string())` | `text()`, `number()`, `boolean()`, `date()`, `select()`, `json<string[]>()` | automatic |
| `image()`, `reference()`, `z.object()`, `z.union()`, `.transform()` | a field chosen by hand in a `collection()` in `sp/` | by hand |
| `file()` loader, a remote loader | a kind in `sp/`, content imported by the owner | by hand |
| `src/layouts/X.astro` with `<slot />` | `sp/app/layout.tsx` with `{children}` | named slots: by hand |
| `src/pages/x.astro` | `sp/app/x/page.tsx` | |
| `src/pages/x.md` | `sp/app/x/page.md` | drop `layout:` |
| `[slug].astro` / `[...slug].astro` + `getStaticPaths()` over a collection | the kind's `url: "/x/:slug"` or `"/x/:path"` + `sp/app/x/[slug]/page.tsx` taking `item` | |
| `getCollection("x")`, `getEntry("x", id)` | `db.query.x.findMany(...)`, `findFirst({ where: { slug } })` | |
| `render(entry)` / `<Content />` | `<Content value={item.body} />` | |
| `Astro.props`, frontmatter variables | component props, the component body | |
| `<a href="/x">` | `<Link href="/x">` | |
| `client:load` / `client:visible` island | `"use client"` component, `useState` from `"spacepress/client"` | npm imports: flag |
| `client:only` | `"use client"` component | renders on the server too |
| `public/` | `public/` | |
| `astro:assets` `<Image>` | `<img>` with a `public/` or media URL | by hand |
| `src/pages/api/*.ts` endpoints | `sp/app/**/route.ts` | by hand |
| middleware, SSR adapter, i18n routing, view transitions | none | flag for the owner |
