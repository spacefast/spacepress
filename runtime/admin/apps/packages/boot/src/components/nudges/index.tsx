import type { ReactElement, ComponentProps } from 'react';
import { Link } from '@wordpress/route';
import { Button, Icon, Stack } from '@wordpress/ui';
import { Notice } from '@wordpress/components';
import { info, cautionFilled, starFilled, bell } from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';
import type { Nudge } from '../../store/types';
import './styles.scss';

interface NudgeDisplayProps {
	nudge: Nudge;
}

const iconMap: Record<
	NonNullable< Nudge[ 'icon' ] >,
	ReactElement< ComponentProps< 'svg' > >
> = {
	info,
	warning: cautionFilled,
	star: starFilled,
	bell,
};

const actionStyleToVariant: Record<
	NonNullable< NonNullable< Nudge[ 'action' ] >[ 'style' ] >,
	'solid' | 'outline' | 'minimal'
> = {
	primary: 'solid',
	secondary: 'outline',
	link: 'minimal',
};

const severityLabels: Record< NonNullable< Nudge[ 'severity' ] >, string > = {
	info: __( 'Information', 'first-admin' ),
	warning: __( 'Warning', 'first-admin' ),
	urgent: __( 'Urgent', 'first-admin' ),
	error: __( 'Error', 'first-admin' ),
};

const severityToStatus: Record<
	NonNullable< Nudge[ 'severity' ] >,
	'info' | 'warning' | 'error'
> = {
	info: 'info',
	warning: 'warning',
	urgent: 'error',
	error: 'error',
};

/**
 * Displays a nudge notification in the sidebar.
 *
 * @param {Object} props       - Component props.
 * @param {Nudge}  props.nudge - The nudge to display.
 */
export function NudgeDisplay( { nudge }: NudgeDisplayProps ) {
	// Validate required nudge fields
	if ( ! nudge?.id || ! nudge?.type || ! nudge?.severity || ! nudge?.title ) {
		return null;
	}

	const iconElement = nudge.icon ? iconMap[ nudge.icon ] : undefined;

	const buttonVariant =
		nudge.action?.style && actionStyleToVariant[ nudge.action.style ]
			? actionStyleToVariant[ nudge.action.style ]
			: 'outline';

	return (
		<Notice
			status={ severityToStatus[ nudge.severity ] }
			isDismissible={ false }
			className={ `first-admin-nudge first-admin-nudge--${ nudge.severity }` }
		>
			<Stack direction="row" gap="sm" align="flex-start">
				{ iconElement && (
					<Icon
						icon={ iconElement }
						size={ 24 }
						aria-label={ sprintf(
							/* translators: %s: severity level (Information, Warning, Urgent, Error) */
							__( '%s notification', 'first-admin' ),
							severityLabels[ nudge.severity ] || nudge.severity
						) }
					/>
				) }

				<Stack
					direction="column"
					gap="sm"
					className="first-admin-nudge__content"
				>
					<Stack direction="column">
						<h2 className="first-admin-nudge__title">
							{ nudge.title }
						</h2>

						{ nudge.content && (
							<div className="first-admin-nudge__context">
								{ nudge.content }
							</div>
						) }
					</Stack>

					{ nudge.action && (
						<Button
							variant={ buttonVariant }
							tone="neutral"
							size="compact"
							className="first-admin-nudge__button"
							render={ <Link to={ nudge.action.url } /> }
						>
							{ nudge.action.text }
						</Button>
					) }
				</Stack>
			</Stack>
		</Notice>
	);
}
