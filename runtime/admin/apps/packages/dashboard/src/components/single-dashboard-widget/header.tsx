import { Icon, Stack } from '@wordpress/ui';
import { WidgetBadge, type WidgetBadgeProp } from './badge';
import { WidgetInfoTooltip } from './info-tooltip';
import type { DashboardWidgetType } from '../../types';

type DashboardWidgetHeaderProps = {
	widgetType: DashboardWidgetType< unknown >;
	badge?: WidgetBadgeProp;
};

export default function DashboardWidgetHeader( {
	widgetType,
	badge,
}: DashboardWidgetHeaderProps ) {
	return (
		<Stack
			direction="column"
			className="spacepress-admin-dashboard-widget__header"
			render={ <header /> }
		>
			<Stack direction="row" gap="sm" align="center">
				{ widgetType.icon && (
					<Icon icon={ widgetType.icon } size={ 20 } />
				) }

				{ widgetType.title && (
					<h3 className="spacepress-admin-dashboard-widget__title">
						{ widgetType.title }
					</h3>
				) }

				<WidgetInfoTooltip>{ widgetType.info }</WidgetInfoTooltip>

				<WidgetBadge badge={ badge } />
			</Stack>

			{ widgetType.description && (
				<div className="spacepress-admin-dashboard-widget__description">
					{ widgetType.description }
				</div>
			) }
		</Stack>
	);
}
