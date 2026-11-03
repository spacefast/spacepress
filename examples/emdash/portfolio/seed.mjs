import { readFile } from 'node:fs/promises';

const escape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Convert the pinned example's Portable Text into native editable WordPress blocks. */
async function content(blocks, upload) {
  const result = [];
  for (const block of blocks ?? []) {
    if (block._type === 'image') {
      const media = await upload(block.asset.$media);
      result.push(`<!-- wp:image {"id":${media.id}} --><figure class="wp-block-image"><img src="${escape(media.source_url)}" alt="${escape(block.alt)}" class="wp-image-${media.id}"/><figcaption class="wp-element-caption">${escape(block.caption)}</figcaption></figure><!-- /wp:image -->`);
      continue;
    }
    if (block._type !== 'block') throw new Error(`Unsupported seed content: ${block._type}`);
    const text = (block.children ?? []).map((child) => {
      let text = escape(child.text);
      for (const mark of child.marks ?? []) {
        if (mark === 'strong') text = `<strong>${text}</strong>`;
        else if (mark === 'em') text = `<em>${text}</em>`;
        else {
          const definition = block.markDefs?.find((d) => d._key === mark);
          if (definition?._type === 'link' && /^https?:\/\//i.test(definition.href)) text = `<a href="${escape(definition.href)}">${text}</a>`;
        }
      }
      return text;
    }).join('');
    if (block.listItem) result.push(`<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>${text}</li><!-- /wp:list-item --></ul><!-- /wp:list -->`);
    else if (/^h[2-6]$/.test(block.style)) result.push(`<!-- wp:heading {"level":${Number(block.style.slice(1))}} --><${block.style} class="wp-block-heading">${text}</${block.style}><!-- /wp:heading -->`);
    else if (block.style === 'blockquote') result.push(`<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>${text}</p><!-- /wp:paragraph --></blockquote><!-- /wp:quote -->`);
    else result.push(`<!-- wp:paragraph --><p>${text}</p><!-- /wp:paragraph -->`);
  }
  return result.join('\n');
}

export async function seedPortfolio({ api, upload }) {
  const seed = JSON.parse(await readFile(new URL('./seed.json', import.meta.url), 'utf8'));
  const settings = await api('/globals/settings', { method: 'PATCH', body: {
    title: seed.settings.title, tagline: seed.settings.tagline, separator: '—',
    social: { github: '@norma', instagram: 'norma.studio', linkedin: 'https://www.linkedin.com/company/norma/' },
    navigation: seed.menus.find((m) => m.name === 'primary').items.map((i) => ({ label: i.label, href: i.url })),
    footer: seed.menus.find((m) => m.name === 'footer').items.map((i) => ({ label: i.label, href: i.url })),
  } });
  const projects = [];
  for (const [i, source] of seed.projects.entries()) {
    const p = source.data;
    const cover = await upload(p.featured_image.$media);
    const gallery = [];
    for (const g of p.gallery ?? []) gallery.push({ image: (await upload(g.image.$media)).id, caption: g.caption ?? '' });
    const row = await api('/projects', { method: 'POST', body: {
      title: p.title, slug: source.slug, status: 'published', publishedAt: `2026-0${i + 1}-01T12:00:00Z`,
      summary: p.summary, client: p.client, year: p.year, featured: p.featured,
      website: p.url ?? null, cover: cover.id, tags: source.taxonomies.tag,
      body: await content(p.content, upload), gallery,
    } });
    projects.push(row);
  }
  const pages = [];
  for (const source of seed.pages) {
    const layout = (source.data.layout ?? []).map((b) => {
      const { _type, _version, _key, email_label, ...values } = b;
      const type = { portfolio_statement: 'statement', portfolio_selected_work: 'selectedWork', portfolio_clients: 'clients', portfolio_contact: 'contact' }[_type];
      if (!type) throw new Error(`Unsupported seed layout: ${_type}`);
      return { layout: type, ...values, ...(email_label ? { emailLabel: email_label } : {}) };
    });
    pages.push(await api('/pages', { method: 'POST', body: {
      title: source.data.title, slug: source.slug, status: 'published',
      body: await content(source.data.content, upload), layout,
    } }));
  }
  return { settings, projects, pages };
}
