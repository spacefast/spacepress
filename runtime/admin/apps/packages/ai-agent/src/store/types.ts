/**
 * Base context entry interface with closure pattern for fetching fresh data.
 *
 * @template T - The type of context data
 */
interface BaseContextEntry< T > {
	/** Closure that fetches current context data from the appropriate store */
	getData: () => T;
	/** Resolved context data (populated by consumer when getData is called) */
	data?: T;
}

/**
 * Entity context entry for WP entities like products, posts, etc.
 * Uses a closure pattern to always fetch fresh data without duplication.
 *
 * @template T - The type of entity data (e.g., ProductEntityRecord, PostEntityRecord)
 */
export interface EntityContextEntry< T > extends BaseContextEntry< T > {
	/** Unique identifier for this context entry (used for cleanup) */
	id: string;
	/** Type discriminator */
	type: 'entity';
	/** Entity type (e.g., 'product', 'post', 'page') */
	entityType: string;
	/** Entity ID */
	entityId: string;
}

/**
 * Post type metadata.
 */
export interface PostTypeInfo {
	slug: string;
	label: string;
	restBase: string;
	description?: string;
	viewable?: boolean;
}

/**
 * Expanded route with entity type and action.
 */
export interface ExpandedRoute {
	path: string;
	action: 'create' | 'edit' | 'list' | 'view';
	entityType: string;
	description?: string;
}

/**
 * Related routes for an entity type.
 */
export interface RelatedRoutes {
	create?: string;
	edit?: string;
	list?: string;
}

/**
 * Menu item enriched with related routes.
 */
export interface EnrichedMenuItem {
	id: string;
	to: string;
	label: string;
	parent: string | null;
	relatedRoutes?: RelatedRoutes;
}

/**
 * Sitemap context data structure.
 * Contains navigation metadata for core WordPress functionality.
 * Plugins should register separate context entries.
 */
export interface SitemapData {
	menuItems: EnrichedMenuItem[];
	postTypes: PostTypeInfo[];
	expandedRoutes: ExpandedRoute[];
}

/**
 * Sitemap context entry containing navigation and entity type metadata.
 * Bundles together: enriched menu items, post types, and expanded routes.
 * These are consumed together for navigation/sitemap purposes.
 */
export interface SitemapContextEntry extends BaseContextEntry< SitemapData > {
	/** Unique identifier */
	id: 'sitemap';
	/** Type discriminator */
	type: 'sitemap';
}

/**
 * Sitemap extension context entry for app-specific navigation metadata.
 * Plugins can register additional sitemap data.
 * This data will be merged with the core sitemap by the AI agent.
 *
 * @template T - The type of extension data
 */
export interface SitemapExtensionContextEntry< T >
	extends BaseContextEntry< T > {
	/** Unique identifier (must not be 'sitemap') */
	id: string;
	/** Type discriminator */
	type: 'sitemap';
}

/**
 * Status of an individual onboarding task.
 */
export interface CiabOnboardingTaskStatus {
	/** Unique task identifier */
	id: string;
	/** Display title of the task */
	title: string;
	/** Whether the task has been completed */
	isCompleted: boolean;
	/** Whether the task is locked (e.g., requires a paid plan) */
	isLocked: boolean;
	/** Reason why the task is locked */
	lockedReason?: string;
	/** Whether the task is visible to the user */
	isVisible: boolean;
}

/**
 * Onboarding data structure containing task progress and store status.
 */
export interface CiabOnboardingData {
	/** Array of task statuses */
	tasks: CiabOnboardingTaskStatus[];
	/** Number of completed tasks */
	completedCount: number;
	/** Total number of visible tasks */
	totalCount: number;
	/** Whether the store has been launched (no longer in coming soon mode) */
	isStoreLaunched: boolean;
}

/**
 * Onboarding context entry for tracking store setup progress.
 * Registered when the onboarding component is mounted.
 */
export interface CiabOnboardingContextEntry
	extends BaseContextEntry< CiabOnboardingData | null > {
	/** Unique identifier */
	id: 'ciab-onboarding';
	/** Type discriminator */
	type: 'ciab-onboarding';
}

/**
 * Context entry - discriminated union for different context types.
 */
export type ContextEntry< T = unknown > =
	| EntityContextEntry< T >
	| SitemapContextEntry
	| SitemapExtensionContextEntry< T >
	| CiabOnboardingContextEntry;
