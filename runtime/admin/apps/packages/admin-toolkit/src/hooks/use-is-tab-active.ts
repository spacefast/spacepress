/**
 * External dependencies
 */
import { useEffect, useState } from '@wordpress/element';

/**
 * Track whether the user is actively looking at this page.
 *
 * Returns `true` only when **both** conditions are met:
 * 1. The browser window has keyboard focus (tracks `window` `focus`/`blur` events).
 * 2. The tab is visible (tracks `document.visibilitychange`).
 *
 * Returns `false` when either condition is not met — for example when the user
 * switches to another app, opens undocked DevTools, or navigates to a different
 * browser tab.
 *
 * @example
 * ```tsx
 * function PollingStatus() {
 *   const isActive = useIsTabActive();
 *   return <span>{ isActive ? 'Polling' : 'Paused' }</span>;
 * }
 * ```
 *
 * @return Whether the tab is currently active.
 */
export default function useIsTabActive(): boolean {
	const [ isFocused, setFocused ] = useState( () => document.hasFocus() );
	const [ isVisible, setVisible ] = useState(
		() => document.visibilityState === 'visible'
	);

	useEffect( () => {
		const onFocus = () => setFocused( true );
		const onBlur = () => setFocused( false );
		const onVisibilityChange = () =>
			setVisible( document.visibilityState === 'visible' );

		window.addEventListener( 'focus', onFocus );
		window.addEventListener( 'blur', onBlur );
		document.addEventListener( 'visibilitychange', onVisibilityChange );

		return () => {
			window.removeEventListener( 'focus', onFocus );
			window.removeEventListener( 'blur', onBlur );
			document.removeEventListener(
				'visibilitychange',
				onVisibilityChange
			);
		};
	}, [] );

	return isFocused && isVisible;
}
