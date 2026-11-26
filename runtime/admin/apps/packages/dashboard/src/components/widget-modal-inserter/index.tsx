import { Modal } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import './style.scss';
import WidgetPicker from '../widget-picker';
import { createDashboardWidget } from '../../utils/factory';
import type { DashboardWidget, DashboardWidgetType } from '../../types';

type WidgetModalInserterProps = {
	/**
	 * Callback when the modal should be closed.
	 */
	onClose: () => void;

	/**
	 * A callback function that's called when widget types are selected and inserted.
	 *
	 * @param {DashboardWidget< any >[]} widgets - The created widget instances.
	 */
	onInsert: ( widget: DashboardWidget< any >[] ) => void;
};

export default function WidgetModalInserter( {
	onClose,
	onInsert,
}: WidgetModalInserterProps ) {
	const selectWidgets = ( widgetTypes: DashboardWidgetType< unknown >[] ) => {
		if ( widgetTypes.length === 0 ) {
			return onClose();
		}

		const widgets = widgetTypes.map( ( widgetType ) =>
			createDashboardWidget( widgetType )
		);

		onInsert( widgets );
		onClose();
	};

	return (
		<Modal
			size="large"
			title={ __( 'Add widget', 'spacepress-admin' ) }
			onRequestClose={ onClose }
			className="spacepress-admin-dashboard-widget-modal-inserter"
			focusOnMount="firstContentElement"
		>
			<WidgetPicker onSelect={ selectWidgets } />
		</Modal>
	);
}
