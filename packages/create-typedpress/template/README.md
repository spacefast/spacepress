# __TP_APP_NAME__

```sh
npm run dev
```

Open the **Website** URL printed in the terminal. Edit the heading in `tp/app/page.tsx` and save: the page reloads when TypedPress finishes rebuilding.

| To change | Edit |
| --- | --- |
| The homepage and greeting form | `tp/app/page.tsx` |
| The header, navigation, and styles | `tp/app/layout.tsx` and `tp/app/site.css` |
| Note fields and site settings | `typedpress.config.ts` |
| The server action that answers the form | `tp/actions.ts` |

## Notes

Open **Notes** to see the two sample entries. They are the Markdown files in `content/notes/`, imported once, on the first start. From then on WordPress stores them as posts, and the site shows what WordPress has.

- To change a note, edit it in the WordPress editor.
- Saving a file in `content/notes/` does not change the running site: `npm run dev` does not watch that folder, and the first-start import never overwrites a note WordPress already has. To send file edits to the site, and bring editor changes back into the files, sign in once with `npx typedpress login <Website URL>`, then run `npx typedpress sync` each time.
- To add a note, copy a file in `content/notes/`, delete its `uid` line, and run `npx typedpress sync`. The `uid` identifies one note; two files with the same `uid` fail the build.

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
