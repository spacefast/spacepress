import { allowed, columns, defaults, parseSchema, visible } from './model';
import { fromNative, toNative, nativeEditor } from './api';

test('schema metadata describes labels, help, explicit kind and defaults independently of editor preferences', () => {
	const s = parseSchema({
		collections: {
			things: {
				label: 'Things',
				kind: 'table',
				editor: true,
				primaryKey: 'id',
				columns: {
					id: { type: 'integer', autoIncrement: true },
					name: {
						type: 'text',
						label: 'Display name',
						help: 'Shown publicly',
						notNull: true,
					},
					enabled: { type: 'boolean', default: { value: false } },
					serverDefault: {
						type: 'text', default: { value: 'Server supplies this' },
						access: { create: false, update: 'editor' },
					},
					rootCode: {
						type: 'integer',
						references: { collection: 'roots', column: 'code' },
					},
				},
				access: { read: 'anyone' },
			},
		},
		globals: [],
	});
	expect(s.collections.things.storage).toBe('table');
	expect(s.collections.things.columns.name).toMatchObject({
		label: 'Display name',
		help: 'Shown publicly',
		required: true,
	});
	expect(defaults(s.collections.things.columns, (c) => allowed(c.create, 'editor')))
		.toEqual({ enabled: false });
	expect(s.collections.things.columns.serverDefault.create).toBe(false);
	expect(s.collections.things.columns.rootCode.reference).toEqual({
		collection: 'roots', column: 'code',
	});
});
test('a field labels and explains itself from `.ui()` when the schema gives no label of its own', () => {
	const c = columns({
		buyerEmail: { type: 'email', ui: { label: 'Email', help: 'Where the receipt goes' } },
		code: { type: 'text', label: 'Order code', ui: { label: 'Ignored' } },
		unitPrice: { type: 'number' },
		items: { type: 'repeater', fields: { sku: { type: 'text', ui: { label: 'SKU' } } } },
	});
	expect(c.buyerEmail).toMatchObject({ label: 'Email', help: 'Where the receipt goes' });
	expect(c.code.label).toBe('Order code');
	expect(c.unitPrice.label).toBe('Unit Price');
	expect(c.items.fields.sku.label).toBe('SKU');
});
test('native mapping retains returned typed meta fields without duplicating core fields', () => {
	window.tpAdmin = {
		native: { posts: { path: '/wp/v2/tp_posts', postType: 'tp_posts' } },
		readable: ['posts'],
		role: 'editor',
	};
	const c = {
		name: 'posts', label: 'Posts', primaryKey: 'id', title: 'headline',
		content: 'body', slug: 'path', access: {},
		columns: columns({
			headline: { type: 'text' }, body: { type: 'richText' },
			secret: { type: 'text' }, excerpt: { type: 'text' },
			sections: { type: 'blocks', layouts: {
				hero: { heading: { type: 'text' }, configuration: { type: 'json' } },
			} },
		}),
	};
	const sections = [{ layout: 'hero', heading: 'Welcome', configuration: { enabled: false } }];
	const row = fromNative(c, {
		id: 7, title: { raw: 'Title' }, content: { raw: '<p>Body</p>' },
		meta: {
			unrelated: 'Not a schema field', _crdt_document: 'opaque',
			headline: 'Never duplicate core title', excerpt: 'Visible', sections,
		},
		acf: { tp_secret: 'Ignore the separate SCF representation' },
	});
	expect(nativeEditor(c, row, true)).toBe(true);
	expect(nativeEditor(c, row, false)).toBe(false);
	expect(nativeEditor({ ...c, columns: { ...c.columns, body: { ...c.columns.body, write: 'admin' } } }, row, true)).toBe(false);
	expect(row).toEqual({ id: 7, headline: 'Title', body: '<p>Body</p>', excerpt: 'Visible', sections });
	expect(row.sections).toBe(sections);
	const edit = toNative(c, { headline: 'Changed', sections: row.sections });
	expect(edit).toEqual({ title: 'Changed', meta: { sections } });
	expect(edit.meta).toMatchObject({ sections });
	expect(fromNative(c, { meta: { headline: 'Masked title', body: 'Masked body' } })).toEqual({});
});
test.each([null, '', false, 0, 'false', 'null', {}, [], { nested: [false, ''] }])(
	'native JSON fields preserve the typed value %p', (configuration) => {
		const c = { name: 'posts', label: 'Posts', primaryKey: 'id', access: {}, columns: columns({
			payload: { type: 'json' },
			sections: { type: 'blocks', layouts: { hero: { configuration: { type: 'json' } } } },
		}) };
		const row = { payload: configuration, sections: [{ layout: 'hero', configuration }] };
		expect(fromNative(c, toNative(c, row))).toEqual(row);
		expect(toNative(c, row)).toEqual({ meta: row });
	}
);
test('native taxonomy assignments retain their root property and returned-field masking', () => {
	window.tpAdmin = {
		native: { posts: { path: '/wp/v2/tp_posts', postType: 'tp_posts', terms: { labels: 'tp_tags' } } },
		readable: ['posts'], role: 'editor',
	};
	const c = { name: 'posts', label: 'Posts', primaryKey: 'id', access: {}, columns: columns({
		labels: { type: 'refList', references: { collection: 'tags', column: 'id' } },
		summary: { type: 'text' },
	}) };
	expect(fromNative(c, { tp_tags: [2, 7], meta: { labels: [99], summary: 'Visible' } }))
		.toEqual({ labels: [2, 7], summary: 'Visible' });
	expect(fromNative(c, { meta: { labels: [99] } })).toEqual({});
	expect(toNative(c, { labels: [7], summary: 'Changed' }))
		.toEqual({ tp_tags: [7], meta: { summary: 'Changed' } });
	expect(toNative(c, { labels: [] })).toEqual({ tp_tags: [] });
});
test('conditional fields evaluate sibling values and grouped conditions', () => {
	const condition = {
		OR: [{ kind: { in: ['pro', 'team'] } }, { active: true }],
		postId: { ne: 1 },
	};
	expect(visible(condition, { kind: 'basic', active: true, postId: 2 })).toBe(
		true
	);
	expect(visible(condition, { kind: 'pro', active: false, postId: 1 })).toBe(
		false
	);
	expect(visible({ secret: { isNotNull: true } }, {})).toBe(false);
});
