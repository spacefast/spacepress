import { Icon } from '@wordpress/ui';
// eslint-disable-next-line @spacepress-admin/design-system/use-new-components -- See: ARC-1359
import { Tooltip } from '@spacepress-admin/design-system';
import { info as infoIcon } from '@wordpress/icons';

export function WidgetInfoTooltip( {
	children,
}: {
	children: React.ReactNode;
} ) {
	if ( ! children ) {
		return null;
	}

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={ <span /> }
				className="spacepress-admin-dashboard-widget__info-icon"
			>
				<Icon icon={ infoIcon } size={ 20 } />
			</Tooltip.Trigger>
			<Tooltip.Popup className="spacepress-admin-dashboard-widget__info-tooltip">
				{ children }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}
