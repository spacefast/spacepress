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
		description: __( 'Manage the fonts used on the site.', 'first-admin' ),
		title: __( 'Text', 'first-admin' ),
	},
	link: {
		description: __(
			'Manage the fonts and typography used on the links.',
			'first-admin'
		),
		title: __( 'Links', 'first-admin' ),
	},
	heading: {
		description: __(
			'Manage the fonts and typography used on headings.',
			'first-admin'
		),
		title: __( 'Headings', 'first-admin' ),
	},
	caption: {
		description: __(
			'Manage the fonts and typography used on captions.',
			'first-admin'
		),
		title: __( 'Captions', 'first-admin' ),
	},
	button: {
		description: __(
			'Manage the fonts and typography used on buttons.',
			'first-admin'
		),
		title: __( 'Buttons', 'first-admin' ),
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
						label={ __( 'Select heading level', 'first-admin' ) }
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
							aria-label={ __( 'All headings', 'first-admin' ) }
							label={ _x(
								'All',
								'heading levels',
								'first-admin'
							) }
						/>
						<ToggleGroupControlOption
							value="h1"
							showTooltip
							aria-label={ __( 'Heading 1', 'first-admin' ) }
							label={ __( 'H1', 'first-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h2"
							showTooltip
							aria-label={ __( 'Heading 2', 'first-admin' ) }
							label={ __( 'H2', 'first-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h3"
							showTooltip
							aria-label={ __( 'Heading 3', 'first-admin' ) }
							label={ __( 'H3', 'first-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h4"
							showTooltip
							aria-label={ __( 'Heading 4', 'first-admin' ) }
							label={ __( 'H4', 'first-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h5"
							showTooltip
							aria-label={ __( 'Heading 5', 'first-admin' ) }
							label={ __( 'H5', 'first-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h6"
							showTooltip
							aria-label={ __( 'Heading 6', 'first-admin' ) }
							label={ __( 'H6', 'first-admin' ) }
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
