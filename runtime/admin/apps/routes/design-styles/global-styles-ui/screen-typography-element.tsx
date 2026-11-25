import { __, _x } from '@wordpress/i18n';
import {
	__experimentalToggleGroupControl as ToggleGroupControl,
	__experimentalToggleGroupControlOption as ToggleGroupControlOption,
	__experimentalSpacer as Spacer,
} from '@wordpress/components';
import { useState } from '@wordpress/element';
import TypographyPanel from './typography-panel';
import { ScreenHeader } from './screen-header';
import TypographyPreview from './typography-preview';

const elements = {
	text: {
		description: __( 'Manage the fonts used on the site.', 'spacepress-admin' ),
		title: __( 'Text', 'spacepress-admin' ),
	},
	link: {
		description: __(
			'Manage the fonts and typography used on the links.',
			'spacepress-admin'
		),
		title: __( 'Links', 'spacepress-admin' ),
	},
	heading: {
		description: __(
			'Manage the fonts and typography used on headings.',
			'spacepress-admin'
		),
		title: __( 'Headings', 'spacepress-admin' ),
	},
	caption: {
		description: __(
			'Manage the fonts and typography used on captions.',
			'spacepress-admin'
		),
		title: __( 'Captions', 'spacepress-admin' ),
	},
	button: {
		description: __(
			'Manage the fonts and typography used on buttons.',
			'spacepress-admin'
		),
		title: __( 'Buttons', 'spacepress-admin' ),
	},
};

interface ScreenTypographyElementProps {
	element: keyof typeof elements;
}

function ScreenTypographyElement( { element }: ScreenTypographyElementProps ) {
	const [ headingLevel, setHeadingLevel ] = useState( 'heading' );

	return (
		<>
			<ScreenHeader
				title={ elements[ element ].title }
				description={ elements[ element ].description }
			/>
			<Spacer marginX={ 4 }>
				<TypographyPreview
					element={ element }
					headingLevel={ headingLevel }
				/>
			</Spacer>
			{ element === 'heading' && (
				<Spacer marginX={ 4 } marginBottom="1em">
					<ToggleGroupControl
						label={ __( 'Select heading level', 'spacepress-admin' ) }
						hideLabelFromVision
						value={ headingLevel }
						onChange={ ( value ) =>
							setHeadingLevel( value as string )
						}
						isBlock
						size="__unstable-large"
						__nextHasNoMarginBottom
					>
						<ToggleGroupControlOption
							value="heading"
							showTooltip
							aria-label={ __( 'All headings', 'spacepress-admin' ) }
							label={ _x(
								'All',
								'heading levels',
								'spacepress-admin'
							) }
						/>
						<ToggleGroupControlOption
							value="h1"
							showTooltip
							aria-label={ __( 'Heading 1', 'spacepress-admin' ) }
							label={ __( 'H1', 'spacepress-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h2"
							showTooltip
							aria-label={ __( 'Heading 2', 'spacepress-admin' ) }
							label={ __( 'H2', 'spacepress-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h3"
							showTooltip
							aria-label={ __( 'Heading 3', 'spacepress-admin' ) }
							label={ __( 'H3', 'spacepress-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h4"
							showTooltip
							aria-label={ __( 'Heading 4', 'spacepress-admin' ) }
							label={ __( 'H4', 'spacepress-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h5"
							showTooltip
							aria-label={ __( 'Heading 5', 'spacepress-admin' ) }
							label={ __( 'H5', 'spacepress-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h6"
							showTooltip
							aria-label={ __( 'Heading 6', 'spacepress-admin' ) }
							label={ __( 'H6', 'spacepress-admin' ) }
						/>
					</ToggleGroupControl>
				</Spacer>
			) }
			<TypographyPanel
				element={ element }
				headingLevel={ headingLevel }
			/>
		</>
	);
}

export default ScreenTypographyElement;
