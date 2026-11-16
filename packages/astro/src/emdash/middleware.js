// The request handling EmDash's templates rely on, for a template served by Astro in front of a
// TypedPress site: `/_emdash/admin` opens wp-admin, a comment form posts through to WordPress, and a
// `?preview=` token reads a draft. Prerendered pages pass straight through.
import { backendUrl } from "./client.js";
import { requestContext } from "./context.js";

export async function onRequest(context, next) {
  if (context.isPrerendered) return next();
  const path = context.url.pathname;
  if (path.startsWith("/_emdash/admin")) return context.redirect(`${backendUrl()}/wp-admin/`);
  if (path === "/wp-comments-post.php") {
    if (context.request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    // Only the form body and its type go to WordPress; WordPress answers with its own redirect.
    const answer = await fetch(`${backendUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": context.request.headers.get("content-type") ?? "application/x-www-form-urlencoded" },
      body: await context.request.text(),
      redirect: "manual",
    });
    const headers = new Headers();
    for (const name of ["location", "content-type", "set-cookie"]) {
      const value = answer.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(answer.status >= 300 && answer.status < 400 ? null : await answer.text(), { status: answer.status, headers });
  }
  const preview = context.url.searchParams.get("preview") ?? undefined;
  const month = path === "/posts" ? context.url.searchParams.get("month") ?? undefined : undefined;
  return requestContext.run({ preview, month }, async () => {
    const response = await next();
    if (!preview) return response;
    const out = new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers: response.headers });
    out.headers.set("Cache-Control", "private, no-store");
    out.headers.set("X-Robots-Tag", "noindex");
    // The token is in the URL: don't send it on to other sites.
    out.headers.set("Referrer-Policy", "no-referrer");
    return out;
  });
}
