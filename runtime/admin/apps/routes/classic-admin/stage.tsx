import {
	useParams,
	useNavigate,
	privateApis as routePrivateApis,
} from '@wordpress/route';
import { useEffect, useRef, useState } from 'react';
import { unlock } from '@spacepress-admin/admin-toolkit';
import { siteConfig } from '@spacepress-admin/boot';
import { isUnderAdmin, resolveAdminUrl, slugOf } from './admin-url';

const { useRouter } = unlock( routePrivateApis );

function ClassicAdmin() {
	const { slug } = useParams( { from: '/classic/$slug' } );
	const navigate = useNavigate();
	const router = useRouter();

	// The slug is a path relative to wp-admin/ (`options-media.php`, `edit.php?post_type=page`);
	// the base is the site's `admin_url()`, so a subdirectory install frames the right pages.
	const adminBase = siteConfig().adminUrl;
	const iframeUrl = resolveAdminUrl( decodeURIComponent( slug ), adminBase );

	const [ iframeUrlState, setIframeUrlState ] = useState( iframeUrl );
	const iframeRef = useRef< HTMLIFrameElement >( null );

	// Avoid remounting the iframe content when the location is already correct.
	useEffect( () => {
		if ( iframeUrl !== iframeRef.current?.contentDocument?.URL ) {
			setIframeUrlState( iframeUrl );
		}
	}, [ iframeUrl ] );

	function initializeFrameNavigation( iframeWindow: Window ) {
		function notifyParent( href: string ) {
			const match = (
				router.state.pendingMatches ?? router.state.matches
			).at( -1 );
			const currentSlug = match?.params.slug;

			if ( ! currentSlug ) {
				return;
			}

			const newSlug = slugOf( href, adminBase );
			if ( newSlug === null ) {
				// The frame left wp-admin (a redirect to the front end, say): follow it in the
				// parent instead of recording a route that could never be framed.
				window.location.assign( href );
				return;
			}

			// Only navigate if the slug actually changed
			if ( newSlug !== decodeURIComponent( currentSlug ) ) {
				navigate( {
					to: '/classic/$slug',
					params: { slug: encodeURIComponent( newSlug ) },
				} );
			}
		}

		// Listen for browser navigation events
		iframeWindow.addEventListener( 'popstate', () => {
			notifyParent( iframeWindow.location.href );
		} );
		iframeWindow.addEventListener( 'hashchange', () => {
			notifyParent( iframeWindow.location.href );
		} );

		iframeWindow.addEventListener( 'click', ( e ) => {
			const target = e.target as HTMLElement;
			const link = target.closest( 'a' );
			// Only wp-admin pages stay in the frame; "View Post", the front end,
			// wp-login and other origins open in the parent.
			if ( link && ! link.target && ! isUnderAdmin( link.href, adminBase ) ) {
				link.setAttribute( 'target', '_parent' );
			}
		} );

		// Override pushState and replaceState to catch programmatic navigation
		const originalPushState = iframeWindow.history.pushState;
		const originalReplaceState = iframeWindow.history.replaceState;

		iframeWindow.history.pushState = function ( ...args ) {
			originalPushState.apply( iframeWindow.history, args );
			notifyParent( iframeWindow.location.href );
		};
		iframeWindow.history.replaceState = function ( ...args ) {
			originalReplaceState.apply( iframeWindow.history, args );
			notifyParent( iframeWindow.location.href );
		};

		// Notify on initial load in case of redirects.
		notifyParent( iframeWindow.location.href );
	}

	function handleIframeLoad( {
		currentTarget: iframe,
	}: React.SyntheticEvent< HTMLIFrameElement > ) {
		const iframeDocument = iframe.contentDocument;
		const iframeWindow = iframeDocument?.defaultView;
		if ( ! iframeWindow ) {
			return;
		}

		const initialize = () => {
			if ( iframe.isConnected && iframe.contentDocument === iframeDocument ) {
				initializeFrameNavigation( iframeWindow );
			}
		};

		// WordPress queues its ready handlers through jQuery, which can run after load.
		if ( 'jQuery' in iframeWindow && typeof iframeWindow.jQuery === 'function' ) {
			iframeWindow.jQuery( initialize );
		} else {
			initialize();
		}
	}

	return (
		<iframe
			ref={ iframeRef }
			src={ iframeUrlState }
			onLoad={ handleIframeLoad }
			data-sp-classic-admin=""
			style={ {
				width: '100%',
				height: '100%',
				border: 'none',
				display: 'block',
				backgroundColor: 'white',
			} }
			title="Classic admin page"
		/>
	);
}

export default ClassicAdmin;
