/**
 * AI Agent Slot
 * Simplified provider slot for AI agents.
 * Big Sky Agents Plugin injects the full AI dock UI directly.
 * This component just provides a minimal slot for rendering into.
 */

import { useColorPreference } from '@spacepress-admin/admin-toolkit';
import { privateApis as themePrivateApis } from '@wordpress/theme';
import { unlock } from '@spacepress-admin/private-apis';

// A private API of @wordpress/theme (no public replacement yet), unlocked as core's packages do.
const { useThemeProviderStyles } = unlock( themePrivateApis ) as {
	useThemeProviderStyles: ( options?: {
		color?: { primary?: string; background?: string };
	} ) => { themeProviderStyles: Record< string, string > | null };
};
import { useEffect } from '@wordpress/element';
import { useAbilitiesCleanupOnNavigation } from './use-abilities-cleanup';
import { useEntityCacheInvalidation } from './use-entity-cache-invalidation';

// Export store, store name, and types for context management
export { store, STORE_NAME } from './store';

// Export programmatic AI agent service
export { askAIAgent } from './ai-agent-service';
export type {
	ContextEntry,
	EntityContextEntry,
	SitemapContextEntry,
	SitemapExtensionContextEntry,
	SitemapData,
	PostTypeInfo,
	ExpandedRoute,
	RelatedRoutes,
	EnrichedMenuItem,
	CiabOnboardingContextEntry,
	CiabOnboardingData,
	CiabOnboardingTaskStatus,
} from './store';

interface AIAgentProps {
	onClose?: VoidFunction;
}

/**
 * Resolve a CSS variable reference to its actual value
 * e.g., "var(--wpds-color-private-bg-surface1)" -> "#21496e"
 *
 * @param value  - The CSS value, possibly a var() reference
 * @param styles - Record of CSS variables and their resolved values
 * @return The resolved color value or undefined
 */
function resolveCSSVar(
	value: string | undefined,
	styles: Record< string, string >
): string | undefined {
	if ( ! value ) {
		return undefined;
	}

	// Check if value is a var() reference
	const varMatch = value.match( /^var\((--[\w-]+)\)$/ );
	if ( varMatch ) {
		const varName = varMatch[ 1 ];
		return styles[ varName ];
	}

	// Already a direct value
	return value;
}

/**
 * Minimal AI Agent slot component
 * Big Sky handles all UI rendering via DOM injection
 * Passes computed WPDS theme colors for Big Sky to match CIAB theme
 * @param root0
 * @param root0.onClose
 */
export function AIAgent( { onClose }: AIAgentProps ) {
	const { themeColorSettings } = useColorPreference();
	const { themeProviderStyles } = useThemeProviderStyles( {
		color: themeColorSettings.sidebar,
	} );

	// Clean up route-scoped abilities on navigation
	useAbilitiesCleanupOnNavigation();

	// Enable automatic cache invalidation when abilities modify entities
	useEntityCacheInvalidation();

	// Extract colors helper
	const extractColors = ( styles: Record< string, string > | null ) => {
		if ( ! styles ) {
			return null;
		}

		return {
			sidebarBg: resolveCSSVar(
				styles[ '--wpds-color-background-surface-neutral-weak' ],
				styles
			),
			sidebarPrimary: resolveCSSVar(
				styles[ '--wpds-color-background-interactive-brand-strong' ],
				styles
			),
			fgContentNeutral: resolveCSSVar(
				styles[ '--wpds-color-foreground-content-neutral' ],
				styles
			),
			fgContentNeutralWeak: resolveCSSVar(
				styles[ '--wpds-color-foreground-content-neutral-weak' ],
				styles
			),
			fgInteractiveBrandStrong: resolveCSSVar(
				styles[ '--wpds-color-foreground-interactive-brand-strong' ],
				styles
			),
			strokeInteractiveNeutral: resolveCSSVar(
				styles[ '--wpds-color-stroke-interactive-neutral' ],
				styles
			),
			bgSurfaceNeutral: resolveCSSVar(
				styles[ '--wpds-color-background-surface-neutral' ],
				styles
			),
		};
	};

	// Fire ready event once on mount
	useEffect( () => {
		const colors = extractColors( themeProviderStyles );
		const event = new CustomEvent( 'spacepress-admin-ai-agent-ready', {
			detail: {
				onClose,
				colors,
			},
		} );
		window.dispatchEvent( event );
	}, [ onClose, themeProviderStyles ] ); // Fire when onClose or theme changes

	// Fire theme change event when theme preferences change
	useEffect( () => {
		const colors = extractColors( themeProviderStyles );
		const event = new CustomEvent( 'spacepress-admin-theme-preferences-change', {
			detail: {
				colors,
			},
		} );
		window.dispatchEvent( event );
	}, [ themeProviderStyles ] ); // Fire when theme changes

	return (
		<div
			id="spacepress-admin-ai-agent-slot"
			className="spacepress-admin-ai-agent-slot"
			data-ai-agent-active="true"
		/>
	);
}

export default AIAgent;
