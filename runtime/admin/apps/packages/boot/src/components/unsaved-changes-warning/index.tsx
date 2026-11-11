import { useEffect } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { useEntityValidity } from '@first-admin/admin-toolkit';

/**
 * Warns the user if there are unsaved changes before leaving the editor.
 * Compatible with Post Editor, Site Editor, and Media Editor.
 *
 * Uses modern beforeunload event handling with preventDefault() as primary method
 * and empty returnValue for legacy browser compatibility.
 */
export default function UnsavedChangesWarning() {
	const { isEntityValid, documentChanges } = useEntityValidity();
	const valid = isEntityValid && (documentChanges?.valid ?? true);
	const documentDirty = documentChanges?.dirty ?? false;
	const hasUnsavedChanges = useSelect((select) => {
		const dirtyEntityRecords = select(coreStore).__experimentalGetDirtyEntityRecords();
		return dirtyEntityRecords.length > 0;
	}, []);

	useEffect(() => {
		// Performance optimization: only attach listener when there are unsaved changes
		if (!hasUnsavedChanges && !documentDirty && valid) {
			return;
		}

		/**
		 * Warns the user if there are unsaved changes before leaving the editor.
		 * Modern browsers will show their own generic "Leave site?" dialog.
		 *
		 * @param {BeforeUnloadEvent} event `beforeunload` event.
		 */
		const warnIfUnsavedChanges = (event: BeforeUnloadEvent) => {
			// Modern approach - prevents the default behavior
			event.preventDefault();
			// Legacy browser compatibility (required for Chrome)
			event.returnValue = '';
		};

		window.addEventListener('beforeunload', warnIfUnsavedChanges);

		return () => {
			window.removeEventListener('beforeunload', warnIfUnsavedChanges);
		};
	}, [hasUnsavedChanges, documentDirty, valid]);

	return null;
}
