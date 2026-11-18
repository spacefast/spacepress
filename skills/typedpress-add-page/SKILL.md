---
name: typedpress-add-page
description: "Use when adding a page or an HTTP route to a TypedPress project under `tp/app/`: a `page.tsx` rendered by WordPress on each request, a `layout.tsx`, a dynamic segment such as `[slug]`, a guarded section, or a `route.ts` that answers its own HTTP methods."
compatibility: "Targets TypedPress 0.3 (WordPress 7.2-beta5+, PHP 8.2+). Requires the `typedpress` CLI and Node.js 22+."
---

# Add a page under tp/app/

## When to use

- The app should render a URL itself, from TSX, instead of leaving it to the WordPress theme.
- A URL needs raw HTTP handlers: a feed, a webhook, a form target.

`tp/app/` is optional. Without it, WordPress and its theme render every URL.

## Inputs required

- The URL, and which part of it varies.
- The kinds the page reads: the `schema` tool, or `AGENTS.md`.
- Who may see it.

## Procedure

1. Map the URL to a folder. `tp/app/recipes/[slug]/page.tsx` serves `/recipes/<slug>`.
   `[x]` is one segment, `[...x]` one or more, `[[...x]]` zero or more; `(group)` adds no segment
   and `_private` is never routed.

2. Write the page: a default-exported component, async when it reads data.

   ```tsx
   // tp/app/recipes/[slug]/page.tsx
   import { Content, notFound, type PageProps } from "typedpress/app";
   import { recipes } from "typedpress:db";

   export const metadata = ({ params }: PageProps<"recipes/[slug]">) => ({ title: params.slug });

   export default async function Recipe({ params }: PageProps<"recipes/[slug]">) {
     const recipe = await recipes.get({ slug: params.slug });
     if (!recipe) notFound();
     return (
       <article>
         <h1>{recipe.title}</h1>
         <Content value={recipe.body} />
       </article>
     );
   }
   ```

3. Reads on a page run as the visitor: drafts, rows they may not read and hidden fields never
   reach the HTML. Do not use `<kind>.system` on a page to get around that.

4. Shared chrome goes in `layout.tsx`; it wraps every page below its folder. To require sign-in
   for a section, export `guard` from its layout: `export const guard = "subscriber";`.

5. For raw HTTP, add `route.ts` at the URL's folder and export a function per method, with who
   may call it:

   ```ts
   // tp/app/api/recipes/route.ts
   import { recipes } from "typedpress:db";

   export const guard = "anyone";

   export async function GET() {
     const rows = await recipes.list({ limit: 20 });
     return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(rows.map((r) => r.title)) };
   }
   ```

6. Point TypeScript at TypedPress's JSX types in `tsconfig.json`:
   `{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "typedpress" } }`.

7. Run `typedpress check`, then `typedpress build`. The build writes `tp/_generated/routes.d.ts`, which
   types `PageProps<"recipes/[slug]">` and checks `<Link href>` against the app's routes.

## Verification

- `typedpress check` exits 0, and the `schema` tool lists the page under `routes` with its pattern.
- With the dev site running, open the URL on the address `typedpress dev status` reports. A URL no
  route serves renders `tp/app/not-found.tsx`.

## Failure modes / debugging

- "has both page.tsx and route.ts": one URL, one file. Export the HTTP handlers from `page.tsx`.
- A folder named like a WordPress path (`wp-admin`, `wp-json`, `feed`) is a build error: rename it.
- A misspelled export (`metdata`) is a build error at the file, with the fix.
- TSX compiles to PHP, so only the documented subset works: no React hooks or browser APIs in a
  server component. `typedpress check` names the construct.

## Escalation

- Anything `docs/pages.md` does not describe (client-side interactivity, prerendering): search the
  documentation first, and do not invent an API for it.

Reference: `docs/pages.md` (the folder rules, metadata, guards, links) and `docs/config-api.md`,
section "HTTP routes".
