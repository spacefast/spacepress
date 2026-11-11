import { unlock } from '@first-admin/private-apis';
import { privateApis, ThemeProvider as UpstreamThemeProvider } from '@wordpress/theme';
import { createElement, type ReactNode } from 'react';

interface ThemeColor {
	bg?: string;
	primary?: string;
}

interface ThemeProviderProps {
	children: ReactNode;
	color?: ThemeColor;
	isRoot?: boolean;
}

interface UseThemeProviderStylesOptions {
	color?: ThemeColor;
}

interface UseThemeProviderStylesResult {
	themeProviderStyles: Record< string, string > | null;
}

// @wordpress/theme renamed the `color.bg` seed to `color.background`. Core's
// `wp-theme` script may still read `bg`; pass the seed under both names.
type UpstreamColor = ThemeColor & { background?: string };

interface UnlockedApis {
	useThemeProviderStyles: ( options?: {
		color?: UpstreamColor;
	} ) => UseThemeProviderStylesResult;
}

type UpstreamThemeProviderProps = Omit< ThemeProviderProps, 'color' > & {
	color?: UpstreamColor;
};

const unlockedApis: UnlockedApis = unlock( privateApis );
const Provider = UpstreamThemeProvider as unknown as (
	props: UpstreamThemeProviderProps
) => JSX.Element | null;

function upstreamColor( color: ThemeColor | undefined ): UpstreamColor | undefined {
	return color && { ...color, background: color.bg };
}

export function ThemeProvider( { color, ...props }: ThemeProviderProps ): JSX.Element {
	return createElement( Provider, { ...props, color: upstreamColor( color ) } );
}

export function useThemeProviderStyles(
	options: UseThemeProviderStylesOptions = {}
): UseThemeProviderStylesResult {
	return unlockedApis.useThemeProviderStyles( {
		...options,
		color: upstreamColor( options.color ),
	} );
}
