import {
	allowed,
	columns,
	defaultListColumns,
	defaults,
	parseSchema,
	singularLabel,
	stripHtml,
	visible,
} from './model';
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
test('native mapping retains only returned fields and round-trips SCF values without core-field duplication', () => {
	window.tpAdmin = {
		native: {
			posts: {
				path: '/wp/v2/tp_posts',
				postType: 'tp_posts',
				metaPrefix: 'tp_',
			},
		},
		readable: ['posts'],
		role: 'editor',
	};
	const c = {
		name: 'posts',
		label: 'Posts',
		primaryKey: 'id',
		title: 'headline',
		content: 'body',
		slug: 'path',
		access: {},
		columns: columns({
			headline: { type: 'text' },
			body: { type: 'richText' },
			secret: { type: 'text' },
			excerpt: { type: 'text' },
			sections: {
				type: 'blocks',
				layouts: { hero: { heading: { type: 'text' }, configuration: { type: 'json' } } },
			},
		}),
	};
	const row = fromNative(c, {
		id: 7,
		title: { raw: 'Title' },
		content: { raw: '<p>Body</p>' },
		acf: {
			_source: { tp_excerpt: 'field_tp_excerpt' },
			unrelated: 'Not a schema field',
			tp_excerpt: 'Visible',
			tp_sections: [{ acf_fc_layout: 'hero', heading: 'Welcome' }],
		},
	});
	expect(nativeEditor(c, row, true)).toBe(true);
	expect(nativeEditor(c, row, false)).toBe(false);
	expect(nativeEditor({ ...c, columns: { ...c.columns, body: { ...c.columns.body, write: 'admin' } } }, row, true)).toBe(false);
	expect(row).toEqual({
		id: 7,
		headline: 'Title',
		body: '<p>Body</p>',
		excerpt: 'Visible',
		sections: [{ layout: 'hero', heading: 'Welcome' }],
	});
	expect(toNative(c, { headline: 'Changed', sections: row.sections })).toEqual({
		title: 'Changed',
		acf: { tp_sections: [{ acf_fc_layout: 'hero', heading: 'Welcome' }] },
	});
	// Captured SCF textarea representation of an absent/saved-null JSON scalar.
	const nullRow = fromNative(c, { acf: { tp_sections: [{ acf_fc_layout: 'hero', configuration: '' }] } });
	expect(nullRow.sections).toEqual([{ layout: 'hero', configuration: null }]);
	expect(toNative(c, { sections: nullRow.sections })).toEqual({ acf: { tp_sections: [{ acf_fc_layout: 'hero', configuration: null }] } });
	const emptyString = fromNative(c, { acf: { tp_sections: [{ acf_fc_layout: 'hero', configuration: '\"\"' }] } });
	expect(emptyString.sections).toEqual([{ layout: 'hero', configuration: '' }]);
	expect(toNative(c, { sections: emptyString.sections })).toEqual({ acf: { tp_sections: [{ acf_fc_layout: 'hero', configuration: '\"\"' }] } });
	const falseRow = fromNative(c, { acf: { tp_sections: [{ acf_fc_layout: 'hero', configuration: 'false' }] } });
	expect(falseRow.sections).toEqual([{ layout: 'hero', configuration: false }]);
	expect(toNative(c, { sections: falseRow.sections })).toEqual({ acf: { tp_sections: [{ acf_fc_layout: 'hero', configuration: 'false' }] } });
	// Incoming SCF false still denotes an empty structured/platform field.
	expect(fromNative(c, { acf: { tp_sections: false } }).sections).toBe(false);
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
test('collection table helpers singularize labels, avoid duplicating titleField, skip richText blobs, and decode HTML entities', () => {
	const s = parseSchema({
		collections: {
			docs: {
				label: 'Docs',
				kind: 'collection',
				primaryKey: 'id',
				title: 'title',
				content: 'content',
				slug: 'slug',
				columns: {
					id: { type: 'integer', autoIncrement: true },
					title: { type: 'text' },
					slug: { type: 'text' },
					content: { type: 'richText' },
					description: { type: 'text' },
					status: { type: 'text', enum: ['draft', 'published'] },
				},
				access: { read: 'anyone' },
			},
			entries: {
				label: 'Blog Entries',
				kind: 'collection',
				primaryKey: 'id',
				title: 'title',
				ui: { singularLabel: 'Article', defaultColumns: ['title', 'status', 'category'] },
				columns: {
					id: { type: 'integer', autoIncrement: true },
					title: { type: 'text' },
					status: { type: 'text', enum: ['draft', 'published'] },
					category: { type: 'text' },
				},
				access: { read: 'anyone' },
			},
		},
		globals: [],
	});
	expect(singularLabel(s.collections.docs)).toBe('Doc');
	expect(singularLabel(s.collections.entries)).toBe('Article');
	expect(defaultListColumns(s.collections.docs, 'title')).toEqual(['status', 'slug', 'description']);
	expect(defaultListColumns(s.collections.entries, 'title')).toEqual(['status', 'category']);
	expect(stripHtml('<h2 class="wp-block-heading">Hello</h2> <p>World</p>')).toBe('Hello World');

	window.tpAdmin = {
		native: { docs: { path: '/wp/v2/tp_docs', postType: 'tp_docs', metaPrefix: 'tp_' } },
		readable: ['docs'],
		role: 'admin',
	};
	const decoded = fromNative(s.collections.docs, {
		id: 1,
		title: { rendered: 'MCP &#038; AI Agents' },
		slug: 'mcp-and-agents',
		status: 'publish',
		modified_gmt: '2026-04-01T12:00:00',
		link: 'https://example.com/docs/mcp-and-agents',
	});
	expect(decoded.title).toBe('MCP & AI Agents');
	expect(decoded.status).toBe('published');
	expect(decoded._modified).toBe('2026-04-01T12:00:00');
	expect(decoded._link).toBe('https://example.com/docs/mcp-and-agents');
});
