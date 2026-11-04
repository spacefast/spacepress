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
		description: __( 'Manage the fonts used on the site.', 'zero-admin' ),
		title: __( 'Text', 'zero-admin' ),
	},
	link: {
		description: __(
			'Manage the fonts and typography used on the links.',
			'zero-admin'
		),
		title: __( 'Links', 'zero-admin' ),
	},
	heading: {
		description: __(
			'Manage the fonts and typography used on headings.',
			'zero-admin'
		),
		title: __( 'Headings', 'zero-admin' ),
	},
	caption: {
		description: __(
			'Manage the fonts and typography used on captions.',
			'zero-admin'
		),
		title: __( 'Captions', 'zero-admin' ),
	},
	button: {
		description: __(
			'Manage the fonts and typography used on buttons.',
			'zero-admin'
		),
		title: __( 'Buttons', 'zero-admin' ),
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
						label={ __( 'Select heading level', 'zero-admin' ) }
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
							aria-label={ __( 'All headings', 'zero-admin' ) }
							label={ _x(
								'All',
								'heading levels',
								'zero-admin'
							) }
						/>
						<ToggleGroupControlOption
							value="h1"
							showTooltip
							aria-label={ __( 'Heading 1', 'zero-admin' ) }
							label={ __( 'H1', 'zero-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h2"
							showTooltip
							aria-label={ __( 'Heading 2', 'zero-admin' ) }
							label={ __( 'H2', 'zero-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h3"
							showTooltip
							aria-label={ __( 'Heading 3', 'zero-admin' ) }
							label={ __( 'H3', 'zero-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h4"
							showTooltip
							aria-label={ __( 'Heading 4', 'zero-admin' ) }
							label={ __( 'H4', 'zero-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h5"
							showTooltip
							aria-label={ __( 'Heading 5', 'zero-admin' ) }
							label={ __( 'H5', 'zero-admin' ) }
						/>
						<ToggleGroupControlOption
							value="h6"
							showTooltip
							aria-label={ __( 'Heading 6', 'zero-admin' ) }
							label={ __( 'H6', 'zero-admin' ) }
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
