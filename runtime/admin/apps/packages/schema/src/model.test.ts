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
test('native mapping retains only returned fields and round-trips SCF values without core-field duplication', () => {
	window.zeroAdmin = {
		native: {
			posts: {
				path: '/wp/v2/zero_posts',
				postType: 'zero_posts',
				metaPrefix: 'zero_',
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
			_source: { zero_excerpt: 'field_zero_excerpt' },
			unrelated: 'Not a schema field',
			zero_excerpt: 'Visible',
			zero_sections: [{ acf_fc_layout: 'hero', heading: 'Welcome' }],
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
		acf: { zero_sections: [{ acf_fc_layout: 'hero', heading: 'Welcome' }] },
	});
	// Captured SCF textarea representation of an absent/saved-null JSON scalar.
	const nullRow = fromNative(c, { acf: { zero_sections: [{ acf_fc_layout: 'hero', configuration: '' }] } });
	expect(nullRow.sections).toEqual([{ layout: 'hero', configuration: null }]);
	expect(toNative(c, { sections: nullRow.sections })).toEqual({ acf: { zero_sections: [{ acf_fc_layout: 'hero', configuration: null }] } });
	const emptyString = fromNative(c, { acf: { zero_sections: [{ acf_fc_layout: 'hero', configuration: '\"\"' }] } });
	expect(emptyString.sections).toEqual([{ layout: 'hero', configuration: '' }]);
	expect(toNative(c, { sections: emptyString.sections })).toEqual({ acf: { zero_sections: [{ acf_fc_layout: 'hero', configuration: '\"\"' }] } });
	const falseRow = fromNative(c, { acf: { zero_sections: [{ acf_fc_layout: 'hero', configuration: 'false' }] } });
	expect(falseRow.sections).toEqual([{ layout: 'hero', configuration: false }]);
	expect(toNative(c, { sections: falseRow.sections })).toEqual({ acf: { zero_sections: [{ acf_fc_layout: 'hero', configuration: 'false' }] } });
	// Incoming SCF false still denotes an empty structured/platform field.
	expect(fromNative(c, { acf: { zero_sections: false } }).sections).toBe(false);
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
