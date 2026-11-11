import { DropdownMenu } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { search } from '@wordpress/icons';
import ZoomRange from './range';

export default function ZoomDropdown( {
	label,
	zoom,
	onChange,
	Component = DropdownMenu,
}: {
	label: string;
	zoom: number;
	onChange: ( value: number ) => void;
	Component?: React.ComponentType< any >;
} ) {
	return (
		<Component
			className="first-admin-media-editor__zoom-dropdown"
			icon={ search }
			label={ __( 'Zoom', 'first-admin' ) }
			popoverProps={ {
				placement: 'bottom-start',
				className: 'first-admin-media-editor__zoom-dropdown-popover',
			} }
			toggleProps={ {
				variant: 'tertiary',
				className: 'first-admin-media-editor__zoom-dropdown-button',
			} }
		>
			{ () => (
				<ZoomRange
					label={ label }
					zoom={ zoom }
					onChange={ onChange }
					showLabel={ false }
				/>
			) }
		</Component>
	);
}
