export enum PluginAction {
	Activate,
	Deactivate,
	AutoUpdatesEnabled,
	AutoUpdatesDisabled,
	Updated,
}

/**
 * Map the updated path/value to a constrained action string for notices.
 * Falls back to PluginAction.Updated for unrecognized paths.
 *
 * @param path  The property path that was updated (e.g., ['status'] or ['auto_update']).
 * @param value The value being set at the given path.
 */
export function resolvePluginAction(
	path: string[] | undefined,
	value: unknown
): PluginAction {
	if ( Array.isArray( path ) && path.length === 1 ) {
		switch ( path[ 0 ] ) {
			case 'status':
				return value === 'active'
					? PluginAction.Activate
					: PluginAction.Deactivate;
			case 'auto_update': {
				return value === true
					? PluginAction.AutoUpdatesEnabled
					: PluginAction.AutoUpdatesDisabled;
			}
			default:
				break;
		}
	}
	return PluginAction.Updated;
}
