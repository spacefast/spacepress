export interface WpOrgContributor {
	profile?: string;
	display_name?: string;
	avatar?: string;
}

export interface WpOrgPlugin {
	name: string;
	slug: string;
	version?: string;
	author?: string;
	author_profile?: string;
	homepage?: string;
	last_updated?: string;
	requires?: string;
	tested?: string;
	requires_php?: string;
	rating?: number; // percent 0..100
	num_ratings?: number;
	ratings?: Record< string, number >; // keys '1'..'5'
	active_installs?: number;
	downloaded?: number;
	donate_link?: string;
	short_description?: string;
	description?: string;
	sections?: Record< string, string >;
	banners?: { low?: string; high?: string };
	icons?: Record< string, string >;
	contributors?: Record< string, WpOrgContributor >;
	external?: boolean | string;
}
