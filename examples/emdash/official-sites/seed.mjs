// Imports a pinned upstream seed.json into a First site through its API (`/__first/api/v1`) as the
// administrator: settings, the primary menu, categories, tags, byline credits, the widget areas,
// posts and pages with their terms, and the posts' cover images. Test seeding only: nothing here
// runs when the template serves pages.
import { readFile } from 'node:fs/promises';

const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The seed's Portable Text as WordPress block markup. */
export function blocksHtml(blocks = []) {
  return blocks.map((block) => {
    if (block._type !== 'block') throw new Error(`Unsupported upstream seed block: ${block._type}`);
    const style = block.style ?? 'normal';
    const tag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(style) ? style : 'p';
    const text = (block.children ?? []).map((span) => {
      let part = escape(span.text ?? '');
      for (const mark of span.marks ?? []) {
        if (mark === 'strong') part = `<strong>${part}</strong>`;
        else if (mark === 'em') part = `<em>${part}</em>`;
        else if (mark === 'code') part = `<code>${part}</code>`;
        else {
          const def = (block.markDefs ?? []).find((d) => d._key === mark && d._type === 'link');
          if (def) part = `<a href="${escape(def.href)}">${part}</a>`;
        }
      }
      return part;
    }).join('');
    const name = tag.startsWith('h') ? 'heading' : tag === 'blockquote' ? 'quote' : 'paragraph';
    const attrs = name === 'heading' ? ` {"level":${tag.slice(1)}}` : '';
    const cls = name === 'heading' ? ' class="wp-block-heading"' : name === 'quote' ? ' class="wp-block-quote"' : '';
    return `<!-- wp:${name}${attrs} --><${tag}${cls}>${text}</${tag}><!-- /wp:${name} -->`;
  }).join('\n\n');
}

export async function seed({ backend, authorization, mode, seedFile, wp }) {
  const data = JSON.parse(await readFile(seedFile, 'utf8'));
  async function api(method, path, body, headers = {}) {
    const init = { method, headers: { authorization, ...headers } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const response = await fetch(`${backend}${path}`, init);
    const json = await response.json();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
    return json.data ?? json;
  }
  const first = (path, ...rest) => api(rest.length ? rest[0] : 'GET', `/__first/api/v1${path}`, ...rest.slice(1));

  await first('/settings', 'PATCH', { title: data.settings.title, tagline: data.settings.tagline });
  await wp('option', 'update', 'comment_moderation', '1');
  await wp('option', 'update', 'comment_previously_approved', '0');
  // Menus: WordPress's own, at the `primary` location the mu-plugin registers.
  for (const menu of data.menus ?? []) {
    const id = await wp('menu', 'create', menu.label, '--porcelain');
    for (const item of menu.items) await wp('menu', 'item', 'add-custom', id, item.label, item.url);
    await wp('menu', 'location', 'assign', id, menu.name);
  }
  const terms = { category: {}, tag: {} };
  for (const taxonomy of data.taxonomies ?? []) {
    for (const term of taxonomy.terms) terms[taxonomy.name][term.slug] = (await first(`/${taxonomy.name}`, 'POST', { name: term.label, slug: term.slug })).id;
  }
  const credits = {};
  for (const byline of data.bylines ?? []) credits[byline.id] = (await first('/credits', 'POST', { name: byline.displayName, slug: byline.slug })).id;
  if (data.widgetAreas) await first('/widgets', 'PATCH', { areas: data.widgetAreas });
  return seedContent(data, first, mode, { terms, credits });
}

async function seedContent(data, first, mode, { terms = {}, credits = {} }) {
  const entries = [];
  const media = [];
  for (const [collection, list] of Object.entries(data.content)) {
    for (const [index, item] of list.entries()) {
      const body = {
        title: item.data.title,
        slug: item.slug,
        body: blocksHtml(item.data.content ?? []),
        status: item.status === 'published' ? 'published' : 'draft',
        // Newest first, as the seed lists them.
        ...(item.status === 'published' ? { publishedAt: new Date(Date.now() - (index + 1) * 86_400_000).toISOString() } : {}),
        ...(collection === 'posts' ? { excerpt: item.data.excerpt ?? '' } : {}),
      };
      if (collection === 'posts') {
        body.category = (item.taxonomies?.category ?? []).map((slug) => terms.category[slug]);
        body.tag = (item.taxonomies?.tag ?? []).map((slug) => terms.tag[slug]);
        body.credits = (item.bylines ?? []).map((c) => credits[c.byline]);
      }
      const row = await first(`/${collection}`, 'POST', body);
      // A credit's role is per post in the seed and per term here: the last one written holds.
      for (const credit of item.bylines ?? []) if (credit.roleLabel) await first(`/credits/${credits[credit.byline]}`, 'PATCH', { role: credit.roleLabel });
      entries.push({ id: row.id, collection, slug: item.slug, image: item.data.featured_image?.$media ?? null });
    }
  }
  for (const entry of entries) {
    if (!entry.image) continue;
    const response = await fetch(entry.image.url, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`Official seed media failed: ${response.status} ${entry.image.url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: response.headers.get('content-type') ?? 'image/jpeg' }), entry.image.filename);
    form.append('alt', entry.image.alt ?? '');
    const uploaded = await first('/media', 'POST', form);
    await first(`/${entry.collection}/${entry.id}`, 'PATCH', { cover: uploaded.id });
    media.push({ id: uploaded.id, post: entry.id, source: entry.image.url, url: uploaded.url, bytes: bytes.length, bytesSha: null });
  }
  return { entries, media, images: Object.fromEntries(entries.filter((e) => e.image).map((e) => [e.id, e.image])) };
}
