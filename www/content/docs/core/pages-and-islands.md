---
uid: zr_8ef18da62562fe42af48
title: Pages, Layouts & Interactive Islands
description: File-based TSX routing compiled to PHP, progressive forms, "use client" Interactivity API islands, and static export.
order: 4
status: published
publishedAt: 2026-11-21T09:07:00.000Z
---
## File-based routing in `sp/app/`

SpacePress compiles TSX pages and layouts in `sp/app/` directly into server-rendered PHP:

- `sp/app/layout.tsx` — shared shell, `export const template = "theme" | "blank" | "<slug>"`, `metadata`, and CSS imports.
- `sp/app/page.tsx`, `[slug]/page.tsx`, `[...path]/page.tsx`, `(group)/` — static, dynamic, catch-all, and grouped routes.
- `sp/app/not-found.tsx` and `sp/app/login.tsx` — custom 404 and custom WordPress sign-in screens.
- `export const search = { page: integer().default(1) }` — typed query string parsing.
- `export const guard = "authenticated"` — route-level authorization.

With `template = "theme"`, WordPress renders the TSX page in the block theme's
**Page content** block (`<!-- wp:sp/page /-->`). Use the Site Editor to change
the header, footer, or other blocks around it. Use `template = "blank"` when
your layout supplies those elements.

## Built-in server components (`spacepress/app`)

Use `<Link>` (Interactivity Router navigation), `<Content>` (block content via `the_content`), `<Html>` (sanitized HTML), `<Comments>`, `<Pagination>`, `<Search>`, `<SearchResults>`, `<LoginForm>`, `<TemplatePart>`, `<Live id="...">`, and `useFormState(action)` for progressive zero-JS `<form action={myAction}>` submissions.

### Forms that post to an action

A `<form action={contact}>` in a page or server component posts to the action.
It works before any JavaScript loads. The form is sent form-encoded with the
return path and, for a signed-in render, the REST nonce. The browser comes back
to the page with a `303`. Once the router script runs, the same post goes
through `fetch` and the page swaps in place.

```ts
// sp/server.ts
import { mutation } from "spacepress";
import { db, HttpError, mail } from "spacepress/server";
import { messages } from "./schema";

export const contact = mutation({ access: "anyone", rateLimit: "5/min" }, async ({ email, message }: { email: string; message: string }) => {
	if (!email.includes("@")) throw new HttpError(422, "invalid_input", "Enter an email address", "/email");
	await db.insert(messages).values({ email, message });
	await mail.send({ to: "team@example.com", replyTo: email, subject: "New message", text: message });
	return { ok: true };
});
```

```tsx
// sp/app/contact/page.tsx
import { useFormState } from "spacepress/app";
import { contact } from "../../server";

export default function Contact() {
	const state = useFormState(contact);
	return (
		<form action={contact}>
			{state.result && <p role="status">Thanks, we got it.</p>}
			{state.error && <p role="alert">{state.error.message}</p>}
			<label>Email <input name="email" type="email" required /></label>
			{state.error && state.error.fields.email && <small>{state.error.fields.email}</small>}
			<label>Message <textarea name="message" required /></label>
			<button>Send</button>
		</form>
	);
}
```

- **Typed fields.** Each literal `name` inside the form must be one of the
  action's inputs, or the build fails at that field. Controls the browser never
  sends (`type="button"`, `disabled`, a `formAction` elsewhere) aren't checked. `state.values` and
  `state.error.fields` are typed by the same inputs.
- **Field errors.** An `HttpError` with a `pointer` (`"/email"`), or an input
  the action's types refuse, comes back in `state.error.fields`. The field it
  names gets `aria-invalid="true"`.
- **Refill and reset.** After an error, each field gets back what was typed and
  each checkbox or radio what was chosen, over a `defaultValue` or
  `defaultChecked` the page wrote. A `value` the page sets still wins. A password
  is never refilled. After a success, the form starts over with the values the
  page renders.
- **Several forms for one action.** With a form per row, the state comes back
  only on the form that posted.
- **Inline fields only.** The name check and the automatic state apply to fields
  written in the form's own JSX, including inside `.map()`. A field rendered by
  another component inside the form gets neither; use `useFormState` there.
- **Pending.** While a JavaScript submit is in flight, the form has
  `aria-busy="true"` and its submit buttons are disabled. Style
  `form[aria-busy="true"]`.
- **State attribute.** After a submit, the form has
  `data-sp-form-state="success"` or `"error"`.

### Show a WordPress comment thread

Enable comments on the kind in `sp/schema.ts`. The SpacePress blog uses native WordPress posts.

```ts
import { wp } from "spacepress";

export const posts = wp.posts.extend({}, {
	url: "/blog/:slug",
	comments: { moderation: "first-time", threaded: 2 },
});
```

Pass the route's post to `<Comments>` in `sp/app/blog/[slug]/page.tsx`.

```tsx
import { Comments } from "spacepress/app";
import type { PageProps } from "./$types";

export default function Post({ item }: PageProps) {
	return <Comments for={item} />;
}
```

The component shows the thread to signed-out readers and a form to signed-in
readers. The form works without JavaScript. WordPress holds comments for review
until the commenter has an approved comment. Editors manage the thread under
**Comments** in wp-admin.

You can pass the same post to `<Comments>` on another page. Both places show
the same WordPress comment thread.

## `"use client"` interactive islands (`"react"` & `"spacepress/react"`)

Start a component file with `"use client";`. Import standard React hooks (`useState`, `useEffect`, `useRef`) from `"react"`, SpacePress client hooks (`useLive`, `useMutation`, `useMount`, `useEvent`, `sharedState`, `uploadFile`) from `"spacepress/react"`, and typed client references (`api`) from `"../_generated/api"`. SpacePress renders the initial HTML in PHP and compiles the interactive logic into a WordPress Interactivity API store with zero React shipped to the page. Importing `"spacepress/server"` or `"spacepress/server/*"` inside a `"use client"` component is refused at build time — use `api` from `_generated/api` or `spacepress/client` instead.

Handlers and effects take ordinary browser code: loops (`for`, `for…of`, `for…in`, `while`, `do…while`) with `break`, `continue` and labels, `switch`, `try`, `throw`, and nested callbacks, including `async` ones such as a click listener that awaits `navigator.clipboard.writeText(…)`. They can call browser globals such as `fetch`, `localStorage`, `setTimeout`, `requestAnimationFrame`, `IntersectionObserver` and `URL`, and set page properties such as `document.title` or `window.location.href`. State still changes only through its setter, and props are read-only.

A callback that runs later, such as a timer, an event listener or a promise callback, can read derived values and refs and call the component's other handlers: the compiler runs those reads in the scope of the handler that set the callback up (the Interactivity API's `withScope`). A handler can call another handler; `await` the call when the other handler is `async`. `this`, `arguments` and `var` aren't supported in client code: read the element from the event or a `useRef()`, use a rest parameter, and declare with `let` or `const`.

```tsx
"use client";
import { useMount } from "spacepress/react";

export function CopyButtons({ label }: { label: string }) {
  useMount(() => {
    for (const pre of Array.from(document.querySelectorAll("pre"))) {
      if (pre.querySelector(".copy")) continue;
      const button = document.createElement("button");
      button.className = "copy";
      button.textContent = label;
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(pre.textContent ?? "");
        button.textContent = "Copied";
      });
      pre.append(button);
    }
  });
  return <span hidden />;
}
```

## Components from npm packages

An installed package can ship `.tsx` components, both server components and
`"use client"` islands, plus the stylesheets they need. Import them from a page,
a layout, or a file in `sp/components/`:

```tsx
// sp/components/docs.tsx
import "@acme/docs-ui/styles.css";
export { Callout, Steps, Step } from "@acme/docs-ui";
export const blocks = ["Callout", "Steps", "Step"];
```

A package exports a stylesheet like any other file, with an `exports` entry such
as `"./styles.css": "./src/styles.css"`. A stylesheet that a block component
file imports links on every route, because content can place the block on any
page. A package that calls `definePlugin()` can ship islands too. Each one is a
`browser` entry in `sp/_generated/plugins.lock.json`: its path in the package,
such as `spacepress-plugin-widget/src/Counter.tsx`, and a hash of its code and
the modules it imports. A new or changed island shows up as a lock
change to review, and `spacepress build --frozen` refuses one the lock doesn't
list.

## Static export

Set `output: "static"` in `defineConfig()` and export `staticParams()` on dynamic routes, then run `spacepress export` to emit a standalone static site to `sp/dist/static/`.

## Page caching on WordPress

Run `spacepress check --json` and inspect `routePlan` for each route's cache class, shared cache window, declared query parameters, and dependencies. The plan includes the route's layouts and metadata.

| Cache class | Meaning |
|---|---|
| `immutable` | A fixed route with literal markup and a blank template. |
| `anonymous-public` | A route with known data dependencies. |
| `request-private` | A route that uses viewer state or has a guard. |
| `unknown` | The compiler could not establish the route's dependencies. |

WordPress can make a response private at runtime. Examples include signed-in requests, WooCommerce cart requests, and pages that set a cookie.

For a fixed route with no query string, the compiler's purge map can cover the reads that the render made. Other shareable pages record their reads by URL, including query variants. Committed writes purge affected URLs and their Markdown twins.

SpacePress automatically prebuilds eligible literal pages on apps without a WooCommerce store, locale routing, or compiled WordPress hooks. Set `export const prerender = false` to opt out. Set `export const prerender = true` to prebuild an eligible page explicitly.
