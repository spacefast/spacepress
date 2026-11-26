// @ts-expect-error - WordPress private APIs
import { privateApis as blockEditorPrivateApis } from '@wordpress/block-editor';
import { unlock } from '@spacepress-admin/admin-toolkit';
import { useStyle, useSetting } from './hooks';

const { useSettingsForBlockElement, TypographyPanel: StylesTypographyPanel } =
	unlock( blockEditorPrivateApis );

interface TypographyPanelProps {
	element: string;
	headingLevel: string;
}

export default function TypographyPanel( {
	element,
	headingLevel,
}: TypographyPanelProps ) {
	let prefixParts: string[] = [];
	if ( element === 'heading' ) {
		prefixParts = prefixParts.concat( [ 'elements', headingLevel ] );
	} else if ( element && element !== 'text' ) {
		prefixParts = prefixParts.concat( [ 'elements', element ] );
	}
	const prefix = prefixParts.join( '.' );

	const [ style ] = useStyle( prefix, '', 'user', false );
	const [ inheritedStyle, setStyle ] = useStyle(
		prefix,
		'',
		'merged',
		false
	);
	const [ rawSettings ] = useSetting( '' );
	const usedElement = element === 'heading' ? headingLevel : element;
	const settings = useSettingsForBlockElement(
		rawSettings,
		undefined,
		usedElement
	);

	return (
		<StylesTypographyPanel
			inheritedValue={ inheritedStyle }
			value={ style }
			onChange={ setStyle }
			settings={ settings }
		/>
	);
}
