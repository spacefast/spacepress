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
		description: __( 'Manage the fonts used on the site.', 'typedpress-admin' ),
		title: __( 'Text', 'typedpress-admin' ),
	},
	link: {
		description: __(
			'Manage the fonts and typography used on the links.',
			'typedpress-admin'
		),
		title: __( 'Links', 'typedpress-admin' ),
	},
	heading: {
		description: __(
			'Manage the fonts and typography used on headings.',
			'typedpress-admin'
		),
		title: __( 'Headings', 'typedpress-admin' ),
	},
	caption: {
		description: __(
			'Manage the fonts and typography used on captions.',
			'typedpress-admin'
		),
		title: __( 'Captions', 'typedpress-admin' ),
	},
	button: {
		description: __(
			'Manage the fonts and typography used on buttons.',
			'typedpress-admin'
		),
		title: __( 'Buttons', 'typedpress-admin' ),
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
						label={ __( 'Select heading level', 'typedpress-admin' ) }
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
							aria-label={ __( 'All headings', 'typedpress-admin' ) }
							label={ _x(
								'All',
								'heading levels',
								'typedpress-admin'
							) }
						/>
						<ToggleGroupControlOption
							value="h1"
							showTooltip
							aria-label={ __( 'Heading 1', 'typedpress-admin' ) }
							label={ __( 'H1', 'typedpress-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h2"
							showTooltip
							aria-label={ __( 'Heading 2', 'typedpress-admin' ) }
							label={ __( 'H2', 'typedpress-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h3"
							showTooltip
							aria-label={ __( 'Heading 3', 'typedpress-admin' ) }
							label={ __( 'H3', 'typedpress-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h4"
							showTooltip
							aria-label={ __( 'Heading 4', 'typedpress-admin' ) }
							label={ __( 'H4', 'typedpress-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h5"
							showTooltip
							aria-label={ __( 'Heading 5', 'typedpress-admin' ) }
							label={ __( 'H5', 'typedpress-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h6"
							showTooltip
							aria-label={ __( 'Heading 6', 'typedpress-admin' ) }
							label={ __( 'H6', 'typedpress-admin' ) }
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
