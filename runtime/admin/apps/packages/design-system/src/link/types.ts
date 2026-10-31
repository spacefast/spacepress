import { type ReactNode } from 'react';
import { type ComponentProps } from '../utils/types';

export interface LinkProps extends Omit< ComponentProps< 'a' >, 'href' > {
	/**
	 * The URL to navigate to when the link is clicked.
	 */
	href?: string;

	/**
	 * The tone of the link. Tone describes a semantic color intent.
	 *
	 * @default "brand"
	 */
	tone?: 'brand' | 'neutral';

	/**
	 * When `true`, the link opens in a new browser tab:
	 * - Sets `target="_blank"` with a merged `rel` including `noreferrer noopener`.
	 * - Appends a directional arrow via CSS pseudoelement (↗ LTR, ↖ RTL) that announces
	 *   "(opens in a new tab)" to screen readers via `aria-label`.
	 * - Prevents navigation for `href="#..."` anchor links (opening `#` in a new tab
	 *   is a no-op and would confuse users).
	 *
	 * @default false
	 */
	openInNewTab?: boolean;

	/**
	 * The content to be rendered inside the component.
	 */
	children?: ReactNode;
}
