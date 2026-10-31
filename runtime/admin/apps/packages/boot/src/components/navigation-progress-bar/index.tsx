import { useEffect, useState } from 'react';
import { unlock } from '@zero-admin/admin-toolkit';
import { privateApis as routePrivateApis } from '@wordpress/route';
import './style.scss';

const { useRouterState } = unlock( routePrivateApis );

/**
 * Delay in milliseconds before showing the loading bar.
 * Prevents visual noise for instant page loads.
 */
const LOADING_BAR_DELAY_MS = 150;

/**
 * NavigationProgressBar component
 *
 * Displays a loading progress bar at the top of the page when navigation is in progress.
 * Uses useRouterState from @wordpress/route to detect navigation state.
 *
 * The bar only appears if navigation takes longer than LOADING_BAR_DELAY_MS,
 * preventing unnecessary visual noise for instant page loads.
 */
export default function NavigationProgressBar() {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- @wordpress/route private API
	const { isLoading, isTransitioning } = useRouterState( {
		select: ( state: {
			isLoading: boolean;
			isTransitioning: boolean;
		} ) => ( {
			isLoading: state.isLoading,
			isTransitioning: state.isTransitioning,
		} ),
	} );

	const [ progress, setProgress ] = useState( 0 );
	const [ delayExpired, setDelayExpired ] = useState( false );

	useEffect( () => {
		if ( isLoading || isTransitioning ) {
			// Start delay timer before showing the bar
			setDelayExpired( false );
			const delayTimer = setTimeout( () => {
				setDelayExpired( true );
				setProgress( 0 );
			}, LOADING_BAR_DELAY_MS );

			return () => clearTimeout( delayTimer );
		}

		setDelayExpired( false );
	}, [ isLoading, isTransitioning ] );

	// Progress animation - only runs when bar is visible
	useEffect( () => {
		if ( ! delayExpired ) {
			return;
		}

		const interval = setInterval( () => {
			setProgress( ( prev ) => {
				// Slow down as we approach 90%
				if ( prev >= 90 ) {
					return prev + 0.5;
				}
				if ( prev >= 70 ) {
					return prev + 1;
				}
				return prev + 3;
			} );
		}, 100 );

		return () => clearInterval( interval );
	}, [ delayExpired ] );

	if ( ! delayExpired || progress === 0 ) {
		return null;
	}

	return (
		<div
			className="navigation-progress-bar"
			role="progressbar"
			aria-valuemin={ 0 }
			aria-valuemax={ 100 }
			aria-valuenow={ Math.round( progress ) }
			aria-label="Navigation progress"
		>
			<div
				className="navigation-progress-bar__fill"
				style={ {
					transform: `translateX(${ progress - 100 }%)`,
				} }
			/>
		</div>
	);
}
