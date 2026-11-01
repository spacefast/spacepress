import type { Post } from '@wordpress/core-data';

export interface PostWithContent extends Post {
	blocks?: Array< Record< string, unknown > >;
}
