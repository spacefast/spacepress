# Your Zero app

```sh
npm run dev
```

Open `/wp-content/plugins/zero-app-__ZERO_APP_NAME__/public/index.html` on the WordPress URL printed by Zero. “Write a note” opens the native WordPress editor; use the local credentials printed in the terminal. Notes are public, and only WordPress editors can change them. Local credentials are for development only. WordPress's existing theme still owns its homepage.

Edit `zero.config.ts` for your backend and `public/` for your frontend. Zero rebuilds on save; refresh your browser to see updates. WordPress serves the frontend, API, login and admin at one origin. No separate frontend server is needed. An external frontend framework is optional; this starter has none. Ordinary page templates can be added when supported by your compiler version.

```sh
npm run check                 # compiler diagnostics, without writing output
npm run typecheck             # generate and check backend + client types
npm run build                # WordPress plugin artifact in .zero/wp-content
npm run dev -- --port 9123    # choose an available port
npm run status
npm run wp -- core version   # WordPress's own WP-CLI
npm run stop                 # stop the site, preserve its SQLite data
```

`client.ts` demonstrates the generated typed client. The static frontend uses same-origin REST directly. Backend TypeScript compiles to PHP and supports a documented subset; it is not a Node.js server. Run `npm run check` when adding library code.

Commit `zero/migrations/`, `zero/client/` and `zero.gen.ts`. `.zero/` is local state and build output. Do not deploy local SQLite files or development credentials. See the Zero installation guide for release availability, compiler overrides and production deployment prerequisites.
