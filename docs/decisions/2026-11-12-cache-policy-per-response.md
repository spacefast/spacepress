# First app pages: cache policy per response, not per route

Date: 2026-11-12. Status: accepted. Spec: [rendering.md](../spec/rendering.md) §6.1–§6.2.

## Problem

rendering.md §6.1 has the compiler decide a policy for each `first/app/` route from what the
route reads:

| The page reads | Policy |
|---|---|
| nothing request-dependent | prebuilt in `dist/` (HTML and `.md`), served before WordPress |
| only content any visitor can read | cacheable: `public, max-age=0, s-maxage=<window>, must-revalidate` |
| anything viewer-dependent | `private, no-store` |

and `first check --json` prints each route's policy and the reason.

Deciding that at build time needs an analysis the compiler doesn't have: proof that every read
a page makes (its own, its layouts', its components', and anything a helper reaches) returns the
same rows for every visitor, and proof that nothing reads the request at all for the prebuilt
case. Access rules can be functions of the viewer, field masks depend on the role, and a layout's
`guard` can be a function.

## Decision

The router decides the policy for each response, from what that response was:

- an anonymous visitor's 200 render of a page that no layout guards is **cacheable**, with the
  spec's header (`public, max-age=0, s-maxage=300, must-revalidate`; the window is the
  `first_app_cache_window` filter). `s-maxage` follows `max-age` on purpose: Batcache reads
  its window with `/^Cache-Control:.*max-?age=(\d+)/i`, which takes the last `max-age=` in
  the header, so the other order stored every page already expired (fixed 2026-11-14);
- every other response (a signed-in visitor, a guarded section, an error, a 404) is
  `private, no-store`, and calls `batcache_cancel()` where Batcache runs.

This is safe without the analysis because every read in a render is already bound to the
visitor (`Seam::asViewer`): an anonymous render shows exactly what any anonymous visitor may see,
whatever the page's code does. A shared cache only ever stores anonymous renders, and signed-in
visitors bypass it at the edge and in Batcache.

Purges (§6.2) are unchanged by this: each cacheable render records the rows it read, and a write
purges exactly the URLs that read the changed row or listed its kind (`First\Render\Cache`).

## Cost

- No per-route policy in `first check --json`: the policy isn't known until a request.
- No prebuilt static pages or prebuilt Markdown twins in `first/dist/`: a page that reads nothing
  still renders in PHP on its first request (and is then served from Batcache and the edge).
- A page whose anonymous render is the same as everyone's but that a signed-in visitor opens is
  rendered for them rather than served from cache; that is how WordPress pages behave today.

## Alternative kept for later

The spec's compile-time policy. It becomes possible once the compiler can show, for each route,
that its reads don't depend on the viewer and whether it reads the request. At that point the
prebuilt policy and `first check --json` reporting can be added on top of this one: the per-response
rule stays as the fallback for routes the analysis can't prove.
