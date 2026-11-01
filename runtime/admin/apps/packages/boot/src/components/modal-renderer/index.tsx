import { useSelect } from '@wordpress/data';
import { store as zeroAdminStore } from '../../store';

/**
 * Renders the first registered modal from the store.
 * Note: WordPress Modal enforces single-modal behavior - when a new modal
 * mounts, it automatically closes any other open modals. This means queue
 * patterns (showing the next modal after closing one) are not supported.
 */
export function ModalRenderer() {
	const modals = useSelect(
		( select ) => select( zeroAdminStore ).getModals(),
		[]
	);

	const modal = modals[ 0 ];

	if ( ! modal ) {
		return null;
	}

	const { component: Component, props } = modal;

	return <Component key={ modal.id } { ...props } />;
}
