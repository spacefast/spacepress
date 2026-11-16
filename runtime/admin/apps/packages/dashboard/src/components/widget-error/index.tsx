import { Button, Icon, Stack } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';
import './style.scss';
import { errorStateIcon } from './error-state-icon';
import type { WidgetErrorConfig } from '../../types';

/**
 * Widget error component.
 * Displays an error state with customizable message, icon, and action.
 * @param props
 * @param props.message
 * @param props.icon
 * @param props.action
 */
export function WidgetError( {
	message = __(
		"We're having trouble loading data. Please try again soon.",
		'typedpress-admin'
	),
	icon,
	action,
}: WidgetErrorConfig ) {
	const iconElement: React.ReactElement< React.ComponentProps< 'svg' > > =
		icon ?? errorStateIcon;

	return (
		<Stack
			direction="column"
			gap="lg"
			align="center"
			justify="center"
			className="typedpress-admin-dashboard-widget-error"
		>
			<Icon icon={ iconElement } size={ 40 } />
			<p className="typedpress-admin-dashboard-widget-error__message">
				{ message }
			</p>
			{ action && (
				<Button
					variant="outline"
					size="compact"
					onClick={ action.onClick }
				>
					{ action.label }
				</Button>
			) }
		</Stack>
	);
}
