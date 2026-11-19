# __ZERO_APP_NAME__

```sh
npm run dev
```

Open the **Website** URL printed in the terminal. Edit the heading in `tp/app/page.tsx`, save, then refresh the page after TypedPress finishes rebuilding.

| To change | Edit |
| --- | --- |
| The homepage and greeting form | `tp/app/page.tsx` |
| The header, navigation, and styles | `tp/app/layout.tsx` and `tp/app/site.css` |
| Note fields and site settings | `typedpress.config.ts` |
| The sample notes | `content/notes/` |
| The server action that answers the form | `tp/actions.ts` |

Open **Notes** to see the Markdown entries imported on first start. WordPress stores them as posts. Edit a note in the WordPress editor, or run `npx typedpress login <Website URL>` followed by `npx typedpress sync` to bring file edits into the running site. The seed keeps edits already saved in WordPress.

Open **Account** to try the signed-in page. Use the local WordPress login printed by `npm run dev`. WordPress returns you to the account page after sign-in.

Add `tp/app/about/page.tsx` to make an **About** page at `/about/`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run check` | Report compiler diagnostics. |
| `npm run typecheck` | Build the app and check its TypeScript types. |
| `npm run build` | Write the WordPress plugin artifact to `tp/dist/wp-content`. |
| `npm run stop` | Stop WordPress and keep its local content. |
| `npx typedpress add db` | Add an example of SQL tables and typed client calls. |

Commit `tp/_generated/` with your source. `tp/dist/` holds build output and `.tp/` holds local WordPress state.
