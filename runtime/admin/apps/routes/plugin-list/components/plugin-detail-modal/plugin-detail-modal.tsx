import { __ } from '@wordpress/i18n';
import { decodeEntities } from '@wordpress/html-entities';
import { Modal, Spinner } from '@wordpress/components';
import { useEffect, useMemo, useState } from '@wordpress/element';
import PluginDetailsContent from './plugin-details-content';
import type { WpOrgPlugin } from './plugin-detail-types';

/**
 * Style dependencies
 */
import './plugin-detail-modal.scss';

// Simple in-memory cache to avoid re-fetching plugin details on every re-render/open
const pluginInfoCache = new Map< string, WpOrgPlugin >();

interface PluginDetailModalProps {
	slug: string;
	onClose: () => void;
}

function useWpOrgPluginDetails( slug: string ) {
	const [ data, setData ] = useState< WpOrgPlugin | null >( null );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState< string | null >( null );

	useEffect( () => {
		let isMounted = true;
		setIsLoading( true );
		setError( null );

		// TypedPress, check cache to avoid re-fetching on every re-render/open
		const cached = pluginInfoCache.get( slug );
		if ( cached ) {
			setData( cached );
			setIsLoading( false );
			return () => {
				isMounted = false;
			};
		}

		// WordPress.org Plugins API (JSON)
		// See: https://api.wordpress.org/plugins/info/1.2/
		const url = new URL( 'https://api.wordpress.org/plugins/info/1.2/' );
		url.searchParams.set( 'action', 'plugin_information' );
		url.searchParams.set( 'request[slug]', slug );
		url.searchParams.set( 'request[fields][sections]', '1' );
		url.searchParams.set( 'request[fields][active_installs]', '1' );
		url.searchParams.set( 'request[fields][ratings]', '1' );
		url.searchParams.set( 'request[fields][icons]', '1' );
		url.searchParams.set( 'request[fields][banners]', '1' );

		fetch( url.toString(), { headers: { Accept: 'application/json' } } )
			.then( async ( res ) => {
				if ( ! res.ok ) {
					throw new Error( `${ res.status } ${ res.statusText }` );
				}
				return ( await res.json() ) as WpOrgPlugin;
			} )
			.then( ( json ) => {
				if ( isMounted ) {
					pluginInfoCache.set( slug, json );
					setData( json );
					setIsLoading( false );
				}
			} )
			.catch( ( e: Error ) => {
				if ( isMounted ) {
					setError( e.message );
					setIsLoading( false );
				}
			} );

		return () => {
			isMounted = false;
		};
	}, [ slug ] );

	return { data, isLoading, error };
}

const ANY_VERSION_RE =
	/(?:^|[\s_-])v?\d+(?:\.\d+)+(?:-(?:alpha|beta|rc|dev|nightly|stable)[\w.-]*)?(?=$|[\s_.-])/gi;

const stripVersions = ( str: string ) =>
	str
		// remove version tokens (and their leading separator)
		.replace( ANY_VERSION_RE, '' )
		// tidy leftover separators before dots (e.g., 'name-.zip' -> 'name.zip')
		.replace( /[-_\s]+(?=\.)/g, '' )
		// collapse multiple separators to a single hyphen
		.replace( /[-_\s]{2,}/g, '-' )
		// trim leading/trailing separators/spaces
		.replace( /(^[-_\s]+|[-_\s]+$)/g, '' );

export default function PluginDetailModal( {
	slug,
	onClose,
}: PluginDetailModalProps ) {
	// We can install plugins with versions like "1.0.0-beta.1", we need to sanitize the slug to remove the version part.
	const { data, isLoading, error } = useWpOrgPluginDetails(
		stripVersions( slug )
	);

	const title = useMemo( () => {
		if ( isLoading ) {
			return __( 'Loading plugin…', 'typedpress-admin' );
		}
		if ( error ) {
			return __( 'Plugin not found', 'typedpress-admin' );
		}
		return decodeEntities( data?.name || slug );
	}, [ isLoading, error, data?.name, slug ] );

	const banner = data?.banners?.high || data?.banners?.low || undefined;

	return (
		<Modal
			onRequestClose={ onClose }
			className="plugin-detail-modal"
			size="large"
			title={ title }
		>
			{ /* Loading state */ }
			{ isLoading && (
				<div className="plugin-details-loading">
					<Spinner />
				</div>
			) }

			{ /* Error state */ }
			{ ! isLoading && error && (
				<div className="plugin-details-error">
					{ __(
						'There was an error fetching plugin details.',
						'typedpress-admin'
					) }
				</div>
			) }

			{ /* Success state */ }
			{ ! isLoading && ! error && data && (
				<PluginDetailsContent data={ data } banner={ banner } />
			) }
		</Modal>
	);
}
