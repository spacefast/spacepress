import { __, _n, sprintf } from '@wordpress/i18n';
import { Link } from '@wordpress/ui';
import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalText as Text,
} from '@wordpress/components';
import type { WpOrgPlugin } from './plugin-detail-types';
import {
	sanitizeHtml,
	humanTimeDiff,
	formatActiveInstalls,
} from './plugin-detail-utils';

interface PluginDetailsInfoProps {
	data: WpOrgPlugin;
	baseUrl: string;
	totalRatings: number;
}

function renderStars( percent: number ): JSX.Element {
	const width = Math.max( 0, Math.min( 100, percent || 0 ) );
	return (
		<span className="plugin-details-stars" aria-hidden>
			<span className="stars-base">★★★★★</span>
			<span className="stars-filled" style={ { width: `${ width }%` } }>
				★★★★★
			</span>
		</span>
	);
}

function getAvatarWithSize( avatar: string, size: number = 36 ): string {
	return avatar + ( avatar.includes( '?' ) ? '&' : '?' ) + `s=${ size }`;
}

export default function PluginDetailsInfo( {
	data,
	baseUrl,
	totalRatings,
}: PluginDetailsInfoProps ) {
	return (
		<VStack spacing={ 3 } className="plugin-details-info">
			{ data.short_description && (
				<Text>{ data.short_description }</Text>
			) }

			{ data.author && (
				<Text variant="muted">
					<strong className="plugin-details-label">
						{ __( 'Author:', 'first-admin' ) }
					</strong>
					<span
						className="plugin-details-author"
						dangerouslySetInnerHTML={ {
							__html: sanitizeHtml( data.author ),
						} }
					/>
				</Text>
			) }

			{ data.version && (
				<Text variant="muted">
					<strong className="plugin-details-label">
						{ __( 'Version:', 'first-admin' ) }
					</strong>
					{ data.version }
				</Text>
			) }

			{ data.last_updated && (
				<Text variant="muted">
					<strong className="plugin-details-label">
						{ __( 'Last updated:', 'first-admin' ) }
					</strong>
					{ humanTimeDiff( data.last_updated ) }
				</Text>
			) }

			{ data.requires && (
				<Text variant="muted">
					<strong className="plugin-details-label">
						{ __( 'Requires WordPress version:', 'first-admin' ) }
					</strong>
					{ data.requires } { __( 'or higher', 'first-admin' ) }
				</Text>
			) }
			{ data.tested && (
				<Text variant="muted">
					<strong className="plugin-details-label">
						{ __( 'Compatible up to:', 'first-admin' ) }
					</strong>
					{ data.tested }
				</Text>
			) }
			{ data.requires_php && (
				<Text variant="muted">
					<strong className="plugin-details-label">
						{ __( 'Requires PHP version:', 'first-admin' ) }
					</strong>
					{ data.requires_php } { __( 'or higher', 'first-admin' ) }
				</Text>
			) }
			{ typeof data.active_installs !== 'undefined' && (
				<Text variant="muted">
					<strong className="plugin-details-label">
						{ __( 'Active installations:', 'first-admin' ) }
					</strong>
					{ formatActiveInstalls( data.active_installs ) }
				</Text>
			) }

			{ data.slug && ! data.external && (
				<Link href={ baseUrl } openInNewTab>
					{ __( 'WordPress.org Plugin Page', 'first-admin' ) }
				</Link>
			) }

			{ /* When we don't have contributors we render here, otherwise we render in the Contributors section below. */ }
			{ data.donate_link && ! data.contributors && (
				<Link href={ data.donate_link } openInNewTab>
					{ __( 'Donate', 'first-admin' ) }
				</Link>
			) }

			{ /* Ratings */ }
			{ totalRatings > 0 && (
				<VStack spacing={ 2 } className="plugin-details-ratings">
					<Text className="plugin-details-side-title">
						{ __( 'Average rating', 'first-admin' ) }
					</Text>
					<div className="plugin-details-average-stars">
						{ renderStars( data.rating || 0 ) }
					</div>
					<Text variant="muted">
						{ sprintf(
							// translators: %s is the total number of reviews (already formatted).
							_n(
								'(based on %s review)',
								'(based on %s reviews)',
								totalRatings,
								'first-admin'
							),
							new Intl.NumberFormat().format( totalRatings )
						) }
					</Text>
					<Text className="plugin-details-side-title">
						{ __( 'Reviews', 'first-admin' ) }
					</Text>

					{ /* Render star reviews */ }
					{ [ 5, 4, 3, 2, 1 ].map( ( stars ) => {
						const count = data.ratings?.[ String( stars ) ] || 0;
						const width = totalRatings
							? Math.round( 92 * ( count / totalRatings ) )
							: 0;
						const href = `https://wordpress.org/support/plugin/${ data.slug }/reviews/?filter=${ stars }`;
						return (
							<HStack
								key={ stars }
								spacing={ 2 }
								alignment={ 'left' }
								className="plugin-details-breakdown-row"
							>
								<Link
									href={ href }
									openInNewTab
									className="plugin-details-breakdown-label"
								>
									{ sprintf(
										// translators: %d is the number of stars the plugin has.
										_n(
											'%d star',
											'%d stars',
											stars,
											'first-admin'
										),
										stars
									) }
								</Link>
								<span
									className="plugin-details-breakdown-bar"
									aria-hidden
								>
									<span style={ { width } } />
								</span>
								<Text
									variant="muted"
									className="plugin-details-breakdown-count"
								>
									{ new Intl.NumberFormat().format( count ) }
								</Text>
							</HStack>
						);
					} ) }
				</VStack>
			) }

			{ /* Contributors */ }
			{ data.contributors && (
				<VStack spacing={ 1 }>
					<Text className="plugin-details-contributors-title">
						{ __( 'Contributors', 'first-admin' ) }
					</Text>
					<div>
						{ Object.entries( data.contributors ).map(
							// The key contains the contributor name too, slightly different from the display_name.
							( [ key, contributor ] ) => (
								<Link
									key={ key }
									href={ contributor.profile || '#' }
									openInNewTab
									className="plugin-details-contributors-link"
								>
									{ contributor.avatar && (
										<img
											src={ getAvatarWithSize(
												contributor.avatar
											) }
											className="plugin-details-contributors-avatar"
											alt={ key }
											width={ 18 }
											height={ 18 }
										/>
									) }
									<span>
										{ contributor.display_name || key }
									</span>
								</Link>
							)
						) }
					</div>
					{ data.donate_link && (
						<Link href={ data.donate_link } openInNewTab>
							{ __( 'Donate', 'first-admin' ) }
						</Link>
					) }
				</VStack>
			) }
		</VStack>
	);
}
