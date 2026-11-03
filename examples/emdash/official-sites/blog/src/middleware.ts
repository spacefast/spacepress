import { defineMiddleware } from 'astro:middleware';
import { requestContext } from '../../shared/context';
import { backendUrl, getSession } from '../../shared/client';
export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  if (path.startsWith('/_emdash/admin')) return context.redirect(`${backendUrl()}/wp-admin/`);
  if (path === '/wp-comments-post.php') {
    return fetch(`${backendUrl()}${path}`, { method: context.request.method, headers: { 'content-type': context.request.headers.get('content-type') ?? 'application/x-www-form-urlencoded' }, body: await context.request.text(), redirect: 'manual' });
  }
  const cookie = context.request.headers.get('cookie');
  if (cookie) context.locals.user = (await getSession(cookie)).user ?? undefined;
  return requestContext.run({ preview: context.url.searchParams.get('preview') ?? undefined, month: context.url.pathname === '/posts' ? context.url.searchParams.get('month') ?? undefined : undefined }, async () => {
    const response = await next();
    if (context.url.searchParams.has('preview')) {
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('X-Robots-Tag', 'noindex');
    }
    return new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers: response.headers });
  });
});
