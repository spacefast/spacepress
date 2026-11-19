# TypedPress frontend builds

Use `@typedpress/frontend` to build browser modules and Tailwind styles for
TypedPress pages. The package sets up Vite, Rolldown, and Tailwind. TypedPress
ships the resulting assets with the app plugin and WordPress serves them.

## Import Tailwind from a page or layout

From this repository's root, run `npm pack ./packages/frontend` to make a
tarball. Install it and Tailwind in the project.

```sh
npm install -D /path/to/typedpress-frontend-0.1.0.tgz tailwindcss
```

Put a plain stylesheet next to a page or layout.

```css
/* tp/app/site.css */
@import "tailwindcss" source("../");
```

```tsx
// tp/app/page.tsx
import "./site.css";

export default function Page() {
  return <h1 className="text-4xl font-semibold">My site</h1>;
}
```

Run `typedpress dev` or `typedpress build`. Installing `@typedpress/frontend`
as a project dependency enables Vite for plain stylesheet imports. The compiler
finds the stylesheets through the page and layout import graph, so each route
links the styles it reaches. CSS modules keep their existing class names and
compiler behavior.

Native `typedpress sources` and `typedpress push` prepare the same assets
before capture. The resulting source capture can compile on a host without
Node.js. Keep `public/typedpress-styles/` and
`tp/_generated/frontend-styles.json` out of Git.

## Build a browser entry

```ts
// browser/index.ts
import "./site.css";
```

```css
/* browser/site.css */
@import "tailwindcss" source(none);
@source "../tp/app";
@source "../tp/components";
```

Run `npx typedpress-frontend`, then add the generated metadata to the page or
layout that needs the assets.

```tsx
// tp/app/page.tsx
import { frontend } from "../_generated/frontend";

export const metadata = frontend.main;

export default function Page() {
  return <h1 className="text-4xl font-semibold">My site</h1>;
}
```

Run `typedpress build` or `typedpress dev` after the frontend build. Run the
frontend build again before capturing sources for a deployment. Keep
`public/typedpress-assets/` and `tp/_generated/frontend.ts` out of Git and
include them in the deployed source capture. The package only replaces a
`public/typedpress-assets/` directory it generated.

Browser modules can use npm dependencies installed in the project, `@/` imports
rooted at `src/`, and `import.meta.env.PUBLIC_*`. JSX entries use the automatic
JSX transform. Install React and React DOM when an entry uses React.

## Build separate entries

Call `buildFrontend` from the project's build script when different pages
need different bundles.

```js
import { buildFrontend } from "@typedpress/frontend";

await buildFrontend({
  entries: {
    site: "browser/site.css",
    search: "browser/search.tsx",
  },
});
```

A CSS entry emits stylesheet metadata. A JavaScript entry emits a launcher, a
preload for the hashed module, and the styles reachable through static imports. Vite splits shared imports and
loads dynamic chunks as needed. Each page can select entries in its
`metadata`. A layout's entries load on every page it wraps.

This command builds browser files. Native server components still compile to
PHP. React components run when the browser entry mounts them. The package
does not server-render React or schedule hydration.
