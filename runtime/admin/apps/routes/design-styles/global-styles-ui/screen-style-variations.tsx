import { Card, CardBody } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { ScreenHeader } from './screen-header';
import { StyleVariationsContent } from './style-variations-content';

function ScreenStyleVariations() {
	return (
		<>
			<ScreenHeader
				title={ __( 'Browse styles', 'spacepress-admin' ) }
				description={ __(
					'Choose a variation to change the look of the site.',
					'spacepress-admin'
				) }
			/>

			<Card
				size="small"
				isBorderless
				className="spacepress-admin-global-styles-screen-style-variations"
			>
				<CardBody>
					<StyleVariationsContent />
				</CardBody>
			</Card>
		</>
	);
}

export default ScreenStyleVariations;
