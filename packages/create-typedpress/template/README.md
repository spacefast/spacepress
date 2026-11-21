# __TP_APP_NAME__

A **SpacePress** (`spacepress.dev`) application compiled from TypeScript into native PHP and WordPress plugins.

## Getting Started

```bash
npm run dev
```

Open the website URL printed in your terminal, and visit `/wp-admin/new/` for SpacePress Admin. Edit `tp/app/page.tsx` or `typedpress.config.ts` and save — the page reloads automatically when SpacePress finishes rebuilding.

## Project Files

- `typedpress.config.ts` — schema definitions (`notes` collection, `site` global) and app config
- `tp/actions.ts` — server actions compiled to native PHP endpoints
- `tp/app/` — file-based TSX pages, layouts, and `site.css`
- `content/notes/` — Markdown notes synchronized with WordPress via `npx typedpress sync`
- `tp/_generated/` — compiler-emitted `db.d.ts`, `routes.d.ts`, migrations, OpenAPI spec, and typed client

## Useful Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start local WordPress + SQLite and rebuild on change |
| `npm run stop` | Stop the local dev server while preserving data |
| `npm run status` | Check local dev server status |
| `npm run check` | Validate schemas, handlers, and pages without writing output |
| `npm run typecheck` | Run `typedpress build --quiet && tsc --noEmit` |
| `npm run build` | Emit WordPress plugins to `tp/dist/wp-content/plugins/` |
| `npm run wp -- <args>` | Run any WP-CLI command against the local site |

## Next Steps

- Sync Markdown content: `npx typedpress sync`
- Add a WooCommerce storefront: `npx typedpress add shop`
- Add SQL tables: `npx typedpress add db`
- Add OpenAPI docs at `/api`: `npx typedpress add api-reference`
- Read the [SpacePress Interactive Guide](https://spacepress.dev/guide)
