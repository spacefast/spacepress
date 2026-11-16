import { useMemo } from '@wordpress/element';
import { useActivatePluginAction } from './activate-plugin-action';
import { useDeactivatePluginAction } from './deactivate-plugin-action';
import { useDeletePluginAction } from './delete-plugin-action';
import { useEnableAutoUpdatesPluginAction } from './enable-auto-updates-plugin-action';
import { useDisableAutoUpdatesPluginAction } from './disable-auto-updates-plugin-action';
import { useUpdatePluginAction } from './update-plugin-action';
import { useViewPluginDetailsAction } from './view-plugin-details-action';

/**
 * Custom hook for the plugin actions.
 */
export function usePluginActions() {
	const activatePluginAction = useActivatePluginAction();
	const deactivatePluginAction = useDeactivatePluginAction();
	const deletePluginAction = useDeletePluginAction();
	const enableAutoUpdatesPluginAction = useEnableAutoUpdatesPluginAction();
	const disableAutoUpdatesPluginAction = useDisableAutoUpdatesPluginAction();
	const updatePluginAction = useUpdatePluginAction();
	const viewPluginDetailsAction = useViewPluginDetailsAction();

	return useMemo(
		() => [
			activatePluginAction,
			deactivatePluginAction,
			enableAutoUpdatesPluginAction,
			disableAutoUpdatesPluginAction,
			viewPluginDetailsAction,
			updatePluginAction,
			deletePluginAction,
		],
		[
			activatePluginAction,
			deactivatePluginAction,
			enableAutoUpdatesPluginAction,
			disableAutoUpdatesPluginAction,
			viewPluginDetailsAction,
			updatePluginAction,
			deletePluginAction,
		]
	);
}
