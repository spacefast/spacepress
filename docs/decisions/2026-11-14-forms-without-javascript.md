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
