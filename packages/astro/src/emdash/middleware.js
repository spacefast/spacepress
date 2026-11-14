// The request handling EmDash's templates rely on, for a template served by Astro in front of a
// First site: `/_emdash/admin` opens wp-admin, a comment form posts through to WordPress, the
// signed-in WordPress user is `Astro.locals.user`, and a `?preview=` token reads a draft.
import { backendUrl, getSession } from "./client.js";
import { requestContext } from "./context.js";

export async function onRequest(context, next) {
  const path = context.url.pathname;
  if (path.startsWith("/_emdash/admin")) return context.redirect(`${backendUrl()}/wp-admin/`);
  if (path === "/wp-comments-post.php") {
    return fetch(`${backendUrl()}${path}`, {
      method: context.request.method,
      headers: { "content-type": context.request.headers.get("content-type") ?? "application/x-www-form-urlencoded" },
      body: await context.request.text(),
      redirect: "manual",
    });
  }
  const cookie = context.request.headers.get("cookie");
  if (cookie) context.locals.user = (await getSession(cookie)).user ?? undefined;
  const preview = context.url.searchParams.get("preview") ?? undefined;
  const month = path === "/posts" ? context.url.searchParams.get("month") ?? undefined : undefined;
  return requestContext.run({ preview, month }, async () => {
    const response = await next();
    if (!preview) return response;
    const out = new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers: response.headers });
    out.headers.set("Cache-Control", "private, no-store");
    out.headers.set("X-Robots-Tag", "noindex");
    return out;
  });
}
