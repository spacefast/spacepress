import { useEffect } from 'react';
import { useSelect } from '@wordpress/data';
import { store as preferencesStore } from '@wordpress/preferences';

function useIconLabelsPreference() {
	const showIconLabels = useSelect( ( select ) => {
		return select( preferencesStore ).get( 'core', 'showIconLabels' );
	}, [] );
	useEffect( () => {
		// We need to add the show-icon-labels class to the body element so it is applied to modals.
		if ( showIconLabels ) {
			document.body.classList.add( 'show-icon-labels' );
		} else {
			document.body.classList.remove( 'show-icon-labels' );
		}
	}, [ showIconLabels ] );
}

export default useIconLabelsPreference;
