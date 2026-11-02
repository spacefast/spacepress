import { columns, defaults, parseSchema, visible } from './model';
import { fromNative, toNative } from './api';

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
	expect(defaults(s.collections.things.columns)).toEqual({ enabled: false });
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
				layouts: { hero: { heading: { type: 'text' } } },
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
