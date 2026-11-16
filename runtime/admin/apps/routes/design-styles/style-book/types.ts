import type { PresetOrigin } from '@zero-admin/global-styles-engine';

/**
 * StyleBook color group configuration
 */
export interface ColorGroup {
	slug: string;
	title: string;
	origin: PresetOrigin;
	type: 'colors' | 'gradients' | 'duotones';
}

/**
 * StyleBook category definition
 */
export interface Category {
	slug: string;
	title: string;
	blocks?: string[];
	subcategories?: Omit< Category, 'subcategories' >[];
	include?: string[];
	exclude?: string[];
}

/**
 * StyleBook category with resolved examples
 */
export interface CategoryExamples {
	slug: string;
	title: string;
	examples?: Example[];
	subcategories?: CategoryExamples[];
}

/**
 * StyleBook example definition
 */
export interface Example {
	name: string;
	title: string;
	category: string;
	blocks: any;
	content?: JSX.Element;
	variation?: string;
}
