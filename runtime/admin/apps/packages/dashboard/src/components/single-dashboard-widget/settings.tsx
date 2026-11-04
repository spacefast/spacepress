import { useCallback, useState } from 'react';
import { Button, IconButton, Stack } from '@wordpress/ui';
import { Modal } from '@wordpress/components';
import { DataForm, type Form } from '@zero-admin/dataviews';
import { __, sprintf } from '@wordpress/i18n';
import { settings } from '@wordpress/icons';
import type { DashboardWidgetType, DashboardWidget } from '../../types';

function isRecord( value: unknown ): value is Record< string, unknown > {
	return typeof value === 'object' && value !== null;
}

type DashboardWidgetSettingsProps = {
	widget: DashboardWidget< unknown >;
	widgetType: DashboardWidgetType< unknown >;
	onChange: ( widget: DashboardWidget< unknown > ) => void;
};

export default function DashboardWidgetSettings( {
	widget,
	widgetType,
	onChange,
}: DashboardWidgetSettingsProps ) {
	const [ isEditMode, setIsEditMode ] = useState( false );
	const [ dashBoardWidgetData, setWidgetData ] = useState< unknown >(
		widget.attributes ?? widgetType.example
	);

	const handleFormChange = useCallback(
		( value: Record< string, unknown > ) => {
			setWidgetData( ( prev: unknown ) =>
				isRecord( prev ) ? { ...prev, ...value } : value
			);
		},
		[]
	);

	const handleSave = useCallback( () => {
		onChange( {
			...widget,
			attributes: dashBoardWidgetData,
		} );
		setIsEditMode( false );
	}, [ setIsEditMode, dashBoardWidgetData, onChange, widget ] );

	if ( ! widgetType.attributes?.length ) {
		return null;
	}

	const form: Form = {
		fields: widgetType.attributes
			.map( ( attr ) => attr.id )
			.filter( Boolean ),
	};

	const settingsTitle = widgetType.title
		? sprintf(
				/* translators: %s: Widget title */
				__( '%s settings', 'zero-admin' ),
				widgetType.title
		  )
		: __( 'Settings', 'zero-admin' );

	return (
		<Stack
			direction="row"
			gap="sm"
			align="center"
			className="zero-admin-dashboard-widget__settings"
		>
			<IconButton
				icon={ settings }
				variant="minimal"
				tone="neutral"
				size="small"
				label={ settingsTitle }
				onClick={ () => setIsEditMode( true ) }
			/>

			{ isEditMode && (
				<Modal
					size="medium"
					title={ settingsTitle }
					onRequestClose={ () => setIsEditMode( false ) }
				>
					<Stack direction="column" gap="lg">
						<DataForm
							data={ dashBoardWidgetData }
							fields={ widgetType.attributes }
							form={ form }
							onChange={ handleFormChange }
						/>

						<Stack direction="row" gap="sm" justify="flex-end">
							<Button
								variant="minimal"
								onClick={ () => setIsEditMode( false ) }
							>
								{ __( 'Cancel', 'zero-admin' ) }
							</Button>
							<Button variant="solid" onClick={ handleSave }>
								{ __( 'Save', 'zero-admin' ) }
							</Button>
						</Stack>
					</Stack>
				</Modal>
			) }
		</Stack>
	);
}
