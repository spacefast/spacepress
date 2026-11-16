export async function seed({ base, wp }) {
  const name = 'plugin-workshop-seed';
  const password = await wp('user', 'application-password', 'create', 'admin', name, '--porcelain');
  try {
    const authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
    const post = async (path, body) => {
      const response = await fetch(`${base}${path}`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      if (!response.ok) throw new Error(`Seed ${path}: ${JSON.stringify(result)}`);
      return result.data ?? result;
    };
    await post('/__tp/api/v1/entries', {
      title: 'Small tools, real effects', status: 'published',
      body: '<!-- wp:paragraph --><p>A good plugin does one useful thing. This workshop brings structured fields, embeds, an inbox, audit history and signed webhooks into a real WordPress site.</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>Open the native editor, change the story, then check the workshop audit history. Your work stays in WordPress.</p><!-- /wp:paragraph -->',
      profile: { name: 'Workshop editor', featured: true },
      ingredients: [{ name: 'A working WordPress site', quantity: 1 }, { name: 'Useful plugins', quantity: 13 }],
      grid: [{ monday: 'Draft', tuesday: 'Publish' }], tags: ['wordpress', 'field notes', 'plugins'],
      palette: '#375c48', embeds: [{ _type: 'youtube', id: 'dQw4w9WgXcQ' }],
    });
    await post('/wp-json/typedpress-plugins/v1/forms', {
      name: 'A note for the workshop',
      pages: [
        { title: 'Introduce yourself', fields: [
          { name: 'name', type: 'text', label: 'Your name', required: true },
          { name: 'email', type: 'email', label: 'Email', required: true },
        ] },
        { title: 'What are you building?', fields: [
          { name: 'message', type: 'textarea', label: 'Your note', required: true, validation: { maxLength: 3000 } },
        ] },
      ], settings: { confirmationMessage: 'Your note is in the workshop inbox.', submitLabel: 'Send note' },
    });
  } finally {
    const credentials = JSON.parse(await wp('user', 'application-password', 'list', 'admin', '--format=json'));
    for (const credential of credentials.filter((item) => item.name === name)) await wp('user', 'application-password', 'delete', 'admin', credential.uuid);
  }
}
