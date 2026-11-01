import type { DescribedCollection, SchemaDescription } from './types';

/** The frozen blog's posts collection, as `/_schema` describes it (tests/fixtures/blog.schema.json). */
export const posts: DescribedCollection = {
	name: 'posts', key: 'posts', label: 'Posts', editor: true, drafts: true, revisions: true, auth: false,
	title: 'title', content: 'body', slug: 'slug', primaryKey: 'id',
	columns: {
		id: { type: 'integer', primaryKey: true, notNull: true },
		title: { type: 'text', notNull: true, rules: { min: 1, max: 120 } },
		slug: { type: 'slug' },
		body: { type: 'richText' },
		excerpt: { type: 'text', rules: { max: 300 } },
		cover: { type: 'media' },
		gallery: { type: 'mediaList' },
		tags: { type: 'select', multiple: true, enum: [ 'news', 'guide', 'release' ], notNull: true, default: { value: [] } },
		authorId: { type: 'integer', references: { collection: 'authors', column: 'id' } },
		seo: { type: 'group', fields: { metaTitle: { type: 'text' }, noindex: { type: 'boolean', notNull: true, default: { value: false } } } },
		sections: { type: 'blocks', layouts: { hero: { heading: { type: 'text' }, image: { type: 'media' } }, quote: { text: { type: 'text' } } } },
		createdAt: { type: 'timestamp', notNull: true, default: { now: true } },
		updatedAt: { type: 'timestamp', notNull: true, default: { now: true } },
		status: { type: 'text', notNull: true, enum: [ 'draft', 'published', 'scheduled' ], default: { value: 'published' }, system: true },
		publishedAt: { type: 'timestamp', system: true },
	},
	access: { read: 'rule', create: 'author', update: 'rule', delete: 'editor' },
	api: { list: true, get: true, create: true, update: true, delete: true },
	wp: { postType: 'zero_posts', groupKey: 'group_zero_posts', metaPrefix: 'zero_', fieldKeyPrefix: 'field_zero_posts_' },
	table: null,
};

/** An `editor: false` table with a hidden column and a per-row read rule. */
export const staff: DescribedCollection = {
	name: 'field_staff', key: 'fieldStaff', label: 'Staff', editor: false, drafts: false, revisions: false, auth: false,
	title: null, content: null, slug: null, primaryKey: 'id',
	columns: {
		id: { type: 'integer', primaryKey: true, autoIncrement: true, notNull: true },
		name: { type: 'text', notNull: true },
		salary: { type: 'integer', access: { read: 'admin', update: 'admin' } },
		kind: { type: 'text', enum: [ 'basic', 'pro' ] },
		active: { type: 'boolean' },
		plan: { type: 'text', showIf: { kind: 'pro' } },
	},
	access: { read: 'anyone', create: 'editor', update: 'editor', delete: 'editor' },
	api: { list: true, get: true, create: true, update: true, delete: true },
	wp: null,
	table: 'zero_staff',
};

export const vault: DescribedCollection = {
	...staff, name: 'vault', key: 'vault', label: 'Vault', table: 'zero_vault',
	access: { read: 'admin', create: 'admin', update: 'admin', delete: 'admin' },
};

export const schema: SchemaDescription = {
	name: 'blog',
	collections: { posts, field_staff: staff, vault },
	globals: {
		settings: { label: 'Site settings', fields: { siteTitle: { type: 'text', notNull: true, default: { value: 'My blog' } }, postsPerPage: { type: 'integer', notNull: true, default: { value: 10 }, rules: { min: 1, max: 50 } } }, access: { read: 'anyone', update: 'editor' } },
		secrets: { label: 'Secrets', fields: { key: { type: 'text' } }, access: { read: 'admin', update: 'admin' } },
	},
	actions: {},
};
