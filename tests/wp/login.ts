// Send only cookies whose server-declared scope matches the requested URL.
// Chromium acceptance owns the complete browser contract; this HTTP seam must not bypass it.
import assert from 'node:assert/strict';
export async function loginCookie(site: string, role: 'admin' | 'editor' | 'subscriber', target = `${site}/wp-admin/new/`): Promise<string> {
 const response = await fetch(`${site}/wp-login.php`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'wordpress_test_cookie=WP%20Cookie%20check' },
  body: new URLSearchParams({ log: role, pwd: `typedpress-test-${role}`, testcookie: '1' }),
 });
 const url = new URL(target);
 const cookies = response.headers.getSetCookie().filter((header) => {
  const parts = header.split(';').map((p) => p.trim());
  const attributes = new Map(parts.slice(1).map((p) => { const i = p.indexOf('='); return [i < 0 ? p.toLowerCase() : p.slice(0, i).toLowerCase(), i < 0 ? '' : p.slice(i + 1)]; }));
  const path = attributes.get('path') ?? '/';
  const domain = attributes.get('domain')?.replace(/^\./, '') ?? new URL(site).hostname;
  return (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) &&
   (url.pathname === path || url.pathname.startsWith(path.endsWith('/') ? path : `${path}/`)) &&
   (!attributes.has('secure') || url.protocol === 'https:') && attributes.get('max-age') !== '0';
 }).map((header) => header.split(';')[0]);
 assert.equal(cookies.some((c) => c.startsWith('wordpress_logged_in_')), true, `${role} signed in (${response.status})`);
 return cookies.join('; ');
}
