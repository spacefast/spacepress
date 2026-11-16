# Forms without JavaScript

## Problem

rendering.md §4.2 says a `<form action={subscribe}>` posts to the action
without JavaScript and comes back to the page "with errors in a flash", and that
`useFormState()` reads it. It doesn't say where the form posts, how a form body
becomes typed action input, where the flash lives, or how a page that shows one
visitor's error stays out of a cache that serves everyone. The JavaScript submit
comes next and must not need any of this undone.

## Decision

**The form posts to the action's facade URL.** `<form action={subscribe}>`
renders `method="post" action="/__first/api/v1/actions/subscribe"`. The request's
content type picks the answer: form-encoded gets `303 See Other`, JSON is
unchanged (`{ data }` or a problem document). The JavaScript submit will fetch
the URL the markup already carries.

- **Rejected: posting to the page URL.** A `page.tsx` may export its own
  `POST` handler.
- **Where to come back to** is a hidden `_first_return` field holding the page's
  path and query. It counts only when it starts with exactly one `/`; otherwise
  the form comes back to `/`.
- **Rejected: Referer.** A referrer policy can strip it.

**A form body reads as the action's input types it.**

- `integer()` and `number()` are read from their digits. A value that doesn't
  parse is passed as text, so the action's own validation names the field.
- A `boolean()` is read from a checkbox: `on`, `true` or `1`, and absent is
  `false`.
- An empty field is absent.
- Repeated names (or `name[]`) form a list, only for list fields. A repeated
  scalar is a 422.
- `_first_return`, `_wpnonce`, `_locale` and `_method` are transport and are
  dropped.
- Any other name reaches the action and is refused as an unknown field, as in
  JSON.
- Multipart is a 415: uploads go through the media API.

**The flash is a sealed cookie named by a URL marker.**

- **Mechanism:** the 303 goes to `<return>?_flash=<id>` and sets
  `first_flash_<id>`. The cookie is sealed with a key derived from the site's
  salt (secretbox, as Live tokens are sealed), and is HttpOnly,
  `SameSite=Lax`, `Max-Age=120`. The page reads it once and deletes it in the
  same response.
- **Contents:** the action's result on success. On failure, the error's code,
  message and field (the first segment of the problem's `pointer`), plus what
  was typed, to fill the form again. A name containing "pass", "secret" or
  "token" is never echoed.
- **Size:** if the sealed cookie would exceed about 3 KB, the typed values go
  first, then the messages are shortened, then the result.
- **Rejected:**
  - a transient or table: anonymous posts could fill it, and it needs cleanup;
  - the error in the query string: it can be forged and shared;
  - a cookie without a marker: a cached copy of the page would still be served.

**A page a form came back to is never shared.** A render whose URL carries
`_flash` is `private, no-store` (with `batcache_cancel()`) and records nothing
for purges. The marker makes the URL one no shared cache has seen. A page with
a form stays cacheable for signed-out visitors, because its markup holds no
nonce.

**Cross-site forms and nonces.**

- A form post with an `Origin` other than the site's is answered with the
  refusal before the action runs.
- A page rendered for a signed-in user (always `private, no-store`) carries the
  REST nonce in a hidden `_wpnonce`, which core's cookie authentication reads.
- Without the nonce, a signed-in cookie is not the user: the action runs signed
  out, as a JSON call without `X-WP-Nonce` does.

**`useFormState(action)` from `"first/app"`** returns
`{ pending, error: { code, message, fields } | null, result, values }`.

- `result` is typed with the action's result.
- `pending` is always `false` on the server. The JavaScript submit will keep
  the same four names in the island's context.
- It is an object, not React's `useActionState` tuple: there is no reducer and
  no returned form action.
- **Rejected: the name `useActionState`.** It would claim React semantics First
  doesn't have.
- **Rejected: a compiler-inserted error region.** It would guess at markup.

**Success comes back to the same page.** To go elsewhere, a page calls the
existing `redirect()` when `state.result` is set. That costs one more hop and
adds no API. A `next` prop was rejected, because the destination usually depends
on the result.

## Costs

- A flash survives at most two minutes and one read. A salt rotation loses
  flashes in flight. That's acceptable for a page the visitor just left.
- A result too large for a cookie reaches the page as "ran" (`result` null,
  `error` null) without its value.
- A signed-in user whose nonce expired while the form was open comes back with
  a sign-in error instead of their result.
- Nothing is stored on the server and no host hook is involved: the host keeps
  no session or per-version state for forms.

## Follow-up (2026-11-16): the JavaScript submit

**Problem.** With scripts on, a submit still loaded the whole page again: the
"JavaScript submit" this decision promised wasn't built. An owner clicking
Restock on a staff page expected it to update in place, as a `<Link>` does.

**The submit is the router's.** `<form action={name}>` and the comments form
render `data-wp-interactive="first/router" data-wp-on--submit="actions.submit"`,
and the router module is enqueued on any page with one, not only on pages with a
`<Link>`. `actions.submit` sits next to `navigate` and `prefetch` in
runtime/First/Render/client/router.js. It takes a plain submit (a post, in this
tab, to this site, from inside the router region), sends the same form-encoded
body with `fetch` (`credentials: "same-origin"`, the hidden `_first_return` and
`_wpnonce` fields exactly as the browser sends them), and lets `fetch` follow
the 303. The HTML of the page it comes back to goes to
`@wordpress/interactivity-router`'s `actions.navigate(url, { html, force })`,
the way client/live-region.js hands the router a changed region: the router
diffs the region, so client components, typed text, focus and scroll stay.

- **The page is fetched once.** The flash cookie is read once and deleted with
  that response. Following the redirect in `fetch` and handing the router that
  HTML means the router never asks for the page again. `force` replaces any
  cached copy of the page in the router's page cache, so going back to it
  shows what the visitor last saw.
- **Rejected: a JSON answer (`{ location }`) for script submits.** It needs a
  second request for the page and a second contract on the action endpoint.
  Following the 303 needs neither, and the server is unchanged.
- **Rejected: `navigate(url)` after the post.** That fetches the page a second
  time, by which point the flash is gone.
- **Rejected: rendering the fetched HTML ourselves.** It would rebuild the
  region and lose client state. The router already diffs.

**The URL bar ends on the page without `?_flash`.** The history entry is the
URL `fetch` ended on with the marker removed. Coming back to the page the form
is on replaces its entry instead of adding one. The no-JavaScript path still
shows the marker, because it can't avoid it. Removing it in the script means
the marker never reaches a URL someone copies, bookmarks or shares. Reloading
afterwards shows the page without the flash, which is right for a read-once
result.

**Pending is an attribute, not state.** While the post is in flight the form
has `aria-busy="true"` and its enabled submit buttons are disabled. A second
submit while one is in flight does nothing. Authors style
`form[aria-busy="true"]`. `useFormState().pending` stays `false`: the page is
server-rendered, and a client copy of the form state would be a second state
system for a few hundred milliseconds of feedback. After the swap, the element
that had focus gets it back if the swap dropped it.

**Fallbacks are the browser's own submit.** If the router module can't load
or the request fails, the script lets the browser post the form, as without
JavaScript. The script also leaves the submit to the browser for:

- an answer that came back to a page without a router region (the browser loads
  that page);
- an answer that isn't a page at all, such as a 503 problem (the browser posts
  again);
- a page core marks as not client-navigable.

Errors (422, a refused origin, an expired nonce) already come back as a 303 to
the page with the error in the flash, so they take the same path as success.

**Costs.**

- A form must be inside the root layout's router region to submit in place.
  First Admin and wp-login.php pages have no region, so their forms post as
  before.
- `formenctype` and file inputs aren't supported: action forms are
  form-encoded, and an upload already answers 415.
- The router's loading bar shows if the page takes longer than 400 ms. The
  screen-reader "page loaded" announcement is off for submits, because the
  page didn't change.
