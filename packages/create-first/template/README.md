# Your First app

```sh
npm run dev
```

Open `/wp-content/plugins/first-app-__ZERO_APP_NAME__/public/index.html` on the WordPress URL printed by First. “Write a note” opens the native WordPress editor; use the local credentials printed in the terminal. Notes are public, and only WordPress editors can change them. Local credentials are for development only. WordPress's existing theme still owns its homepage.

Edit `first.config.ts` for your backend and `public/` for your frontend. First rebuilds on save; refresh your browser to see updates. WordPress serves the frontend, API, login and admin at one origin. No separate frontend server is needed. An external frontend framework is optional; this starter has none. Ordinary page templates can be added when supported by your compiler version.

## Content first, SQL tables when you need them

This starter is content only. `notes` is a `collection()`: its rows are WordPress posts (the post type `first_notes`), edited in wp-admin with drafts and revisions. When the app needs rows it filters, sorts, counts or joins (orders, bookings, votes), add tables:

```sh
npx first add db
```

That writes `first/tables.ts` with two example `table()` kinds, typed client calls and `first/DATABASE.md`, which says when to use which. It never overwrites a file.

## Commands

```sh
npm run check                 # compiler diagnostics, without writing output
npm run typecheck             # generate and check backend + client types
npm run build                # WordPress plugin artifact in first/dist/wp-content
npm run dev -- --port 9123    # choose an available port
npm run status
npm run wp -- core version   # WordPress's own WP-CLI
npm run stop                 # stop the site, preserve its SQLite data
```

## Next

`client.ts` demonstrates the generated typed client. The static frontend uses same-origin REST directly. Backend TypeScript compiles to PHP and supports a documented subset; it is not a Node.js server. Run `npm run check` when adding library code.

Commit `first/_generated/migrations/`, `first/_generated/client/` and `first/_generated/db.d.ts`. `.first/` is local state and build output. Do not deploy local SQLite files or development credentials. See the First installation guide for release availability, compiler overrides and production deployment prerequisites.
