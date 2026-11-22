---
uid: zr_8ef18da62562fe42af48
title: Pages, Layouts & Interactive Islands
description: File-based TSX routing compiled to PHP, progressive forms, "use client" Interactivity API islands, and static export.
order: 4
status: published
publishedAt: 2026-11-21T09:07:00.000Z
---
## File-based routing in `tp/app/`

SpacePress compiles TSX pages and layouts in `tp/app/` directly into server-rendered PHP:

- `tp/app/layout.tsx` — shared shell, `export const template = "theme" | "blank" | "<slug>"`, `metadata`, and CSS imports.
- `tp/app/page.tsx`, `[slug]/page.tsx`, `[...path]/page.tsx`, `(group)/` — static, dynamic, catch-all, and grouped routes.
- `tp/app/not-found.tsx` and `tp/app/login.tsx` — custom 404 and custom WordPress sign-in screens.
- `export const search = { page: integer().default(1) }` — typed query string parsing.
- `export const guard = "authenticated"` — route-level authorization.

With `template = "theme"`, WordPress renders the TSX page in the block theme's
**Page content** block (`<!-- wp:tp/page /-->`). Use the Site Editor to change
the header, footer, or other blocks around it. Use `template = "blank"` when
your layout supplies those elements.

## Built-in server components (`typedpress/app`)

Use `<Link>` (Interactivity Router navigation), `<Content>` (block content via `the_content`), `<Html>` (sanitized HTML), `<Comments>`, `<Pagination>`, `<Search>`, `<SearchResults>`, `<LoginForm>`, `<TemplatePart>`, `<Live id="...">`, and `useFormState(action)` for progressive zero-JS `<form action={myAction}>` submissions.

### Show a WordPress comment thread

Enable comments on the kind in `tp/schema.ts`. The SpacePress blog uses native WordPress posts.

```ts
import { wp } from "typedpress";

export const posts = wp.posts.extend({}, {
	url: "/blog/:slug",
	comments: { moderation: "first-time", threaded: 2 },
});
```

Pass the route's post to `<Comments>` in `tp/app/blog/[slug]/page.tsx`.

```tsx
import { Comments, type PageProps } from "typedpress/app";

export default function Post({ item }: PageProps<"blog/[slug]">) {
	return <Comments for={item} />;
}
```

The component shows the thread to signed-out readers and a form to signed-in
readers. The form works without JavaScript. WordPress holds comments for review
until the commenter has an approved comment. Editors manage the thread under
**Comments** in wp-admin.

You can pass the same post to `<Comments>` on another page. Both places show
the same WordPress comment thread.

## `"use client"` interactive islands (`typedpress/client`)

Start a component file with `"use client";`. SpacePress renders its initial HTML in PHP and compiles the interactive logic into a WordPress Interactivity API store supporting `useState`, `useEffect`, `useMount`, `useEvent`, `useRef`, `sharedState`, and live-updating `useLive(kind, query)` subscriptions.

## Static export

Set `output: "static"` in `defineConfig()` and export `staticParams()` on dynamic routes, then run `typedpress export` to emit a standalone static site to `tp/dist/static/`.
