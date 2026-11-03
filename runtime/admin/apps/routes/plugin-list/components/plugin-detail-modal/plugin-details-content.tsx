import clsx from 'clsx';
import { __ } from '@wordpress/i18n';
import {
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
	Card,
	CardBody,
	TabPanel,
} from '@wordpress/components';
import PluginDetailsInfo from './plugin-details-info';
import { sanitizeHtml } from './plugin-detail-utils';
import type { WpOrgPlugin } from './plugin-detail-types';

const pluginsSectionTitles: Record< string, string > = {
	description: __( 'Description', 'zero-admin' ),
	installation: __( 'Installation', 'zero-admin' ),
	faq: __( 'FAQ', 'zero-admin' ),
	screenshots: __( 'Screenshots', 'zero-admin' ),
	changelog: __( 'Changelog', 'zero-admin' ),
	reviews: __( 'Reviews', 'zero-admin' ),
	other_notes: __( 'Other Notes', 'zero-admin' ),
};

interface PluginDetailsContentProps {
	data: WpOrgPlugin;
	banner?: string;
}

export default function PluginDetailsContent( {
	data,
	banner,
}: PluginDetailsContentProps ) {
	const baseUrl = `https://wordpress.org/plugins/${ data.slug }/`;
	const sections = data.sections || {};
	const order = [
		'description',
		'installation',
		'faq',
		'screenshots',
		'changelog',
		'reviews',
		'other_notes',
	];
	let keys = Object.keys( sections );
	// Move the sections in the order specified in the order array and append the rest to the end.
	keys = [
		...order.filter( ( sectionName ) => keys.includes( sectionName ) ),
		...keys.filter( ( sectionName ) => ! order.includes( sectionName ) ),
	];

	const totalRatings =
		data.num_ratings ||
		Object.values( data.ratings || {} ).reduce( ( a, b ) => a + b, 0 );

	// If there are no ratings, remove the reviews tab.
	if ( ! totalRatings ) {
		keys = keys.filter( ( sectionName ) => sectionName !== 'reviews' );
	}

	const tabs = keys.map( ( sectionName ) => ( {
		name: sectionName,
		title:
			pluginsSectionTitles[ sectionName ] ||
			// Take the key, replace underscores with spaces, then capitalize each word. Not sure if this is the best way to do this.
			sectionName
				.replace( /_/g, ' ' )
				.replace( /\b\w/g, ( c ) => c.toUpperCase() ),
		content: sections[ sectionName ],
	} ) );

	return (
		<VStack spacing={ 4 }>
			<div className="plugin-details-preview-container">
				{ banner ? (
					<img
						src={ banner }
						alt={ __( 'Plugin banner', 'zero-admin' ) }
					/>
				) : null }
			</div>
			<HStack
				spacing={ 6 }
				alignment="flex-start"
				className="plugin-details-modal-content"
			>
				<PluginDetailsInfo
					data={ data }
					baseUrl={ baseUrl }
					totalRatings={ totalRatings }
				/>
				<div className="plugin-details-modal-content-container">
					{ tabs.length > 0 && (
						<TabPanel className="plugin-details-tabs" tabs={ tabs }>
							{ ( tab ) => (
								<Card>
									<CardBody>
										<div
											className={ clsx(
												'plugin-details-section',
												`plugin-details-section-${ tab.name }`
											) }
											dangerouslySetInnerHTML={ {
												__html: sanitizeHtml(
													sections[ tab.name ] || ''
												),
											} }
										/>
									</CardBody>
								</Card>
							) }
						</TabPanel>
					) }
				</div>
			</HStack>
		</VStack>
	);
}
