import { useDispatch, useSelect } from '@wordpress/data';
import { store as preferencesStore } from '@wordpress/preferences';

export interface EnabledExperiments {
	[ key: string ]: boolean;
}

function useExperiments() {
	const enabledExperiments = useSelect(
		( select ) =>
			( select( preferencesStore ).get(
				'core/experiments',
				'enabled'
			) as EnabledExperiments ) || {},
		[]
	);

	const { set } = useDispatch( preferencesStore );

	function isExperimentEnabled( experimentSlug: string ): boolean {
		return enabledExperiments[ experimentSlug ] || false;
	}

	function setExperimentEnabled( experimentSlug: string, enabled: boolean ) {
		const updatedExperiments = {
			...enabledExperiments,
			[ experimentSlug ]: enabled,
		};
		set( 'core/experiments', 'enabled', updatedExperiments );
	}

	return {
		enabledExperiments,
		isExperimentEnabled,
		setExperimentEnabled,
	};
}

export default useExperiments;
