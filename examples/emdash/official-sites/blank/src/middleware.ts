import { defineMiddleware } from 'astro:middleware';
import { backendUrl } from '../../shared/client';
export const onRequest = defineMiddleware((context, next) => context.url.pathname.startsWith('/_emdash/admin') ? context.redirect(`${backendUrl()}/wp-admin/`) : next());
