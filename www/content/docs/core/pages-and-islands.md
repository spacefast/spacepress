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

## Built-in server components (`typedpress/app`)

Use `<Link>` (Interactivity Router navigation), `<Content>` (block content via `the_content`), `<Html>` (sanitized HTML), `<Comments>`, `<Pagination>`, `<Search>`, `<SearchResults>`, `<LoginForm>`, `<TemplatePart>`, `<Live id="...">`, and `useFormState(action)` for progressive zero-JS `<form action={myAction}>` submissions.

## `"use client"` interactive islands (`typedpress/client`)

Start a component file with `"use client";`. SpacePress renders its initial HTML in PHP and compiles the interactive logic into a WordPress Interactivity API store supporting `useState`, `useEffect`, `useMount`, `useEvent`, `useRef`, `sharedState`, and live-updating `useLive(kind, query)` subscriptions.

## Static export

Set `output: "static"` in `defineConfig()` and export `staticParams()` on dynamic routes, then run `typedpress export` to emit a standalone static site to `tp/dist/static/`.
