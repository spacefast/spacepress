import type { Theme } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import type { Action } from '@spacepress-admin/dataviews';
import { useThemeService } from '../hooks/use-theme-service';

const useAutoUpdatesTheme = (): Action< Theme > => {
	const { editTheme } = useThemeService();

	return {
		id: 'auto-updates-theme',
		label: ( [ item ]: Theme[] ) => {
			return item.auto_updates.enabled
				? __( 'Disable auto-updates', 'spacepress-admin' )
				: __( 'Enable auto-updates', 'spacepress-admin' );
		},
		isPrimary: false,
		callback: async ( [ item ]: Theme[] ) => {
			await editTheme(
				item,
				[ 'auto_updates', 'enabled' ],
				! item.auto_updates.enabled
			);
		},
		isEligible: ( item: Theme ) => {
			return (
				item?.permissions?.update === true &&
				item?.auto_updates?.supported === true &&
				item?.auto_updates?.forced === null
			);
		},
	};
};

export default useAutoUpdatesTheme;
