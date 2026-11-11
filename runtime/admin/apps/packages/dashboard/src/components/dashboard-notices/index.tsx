import { Button, Stack } from '@wordpress/ui';
import type { ReactNode } from 'react';
import { Notice } from '@wordpress/components';
import { useDashboardContext } from '../dashboard/context';
import type { DashboardNoticeProps } from '../../types';
import './style.scss';

/**
 * Reusable dashboard notice component with consistent structure.
 * @param {DashboardNoticeProps} props - The props for the dashboard notice component.
 * @return {ReactNode} The dashboard notice component.
 */
export function DashboardNotice( {
	id,
	status,
	message,
	actions,
	onNoticeAction,
}: DashboardNoticeProps ) {
	return (
		<Notice
			status={ status }
			isDismissible={ false }
			className="first-admin-dashboard-notice"
		>
			<Stack direction="column" gap="md">
				<p className="first-admin-dashboard-notice__message">
					{ message }
				</p>
				{ actions && actions.length > 0 && (
					<Stack direction="row" gap="md">
						{ actions.map( ( action ) => (
							<Button
								key={ action.id }
								variant="solid"
								size="compact"
								onClick={ () =>
									onNoticeAction?.( id, action.id )
								}
							>
								{ action.label }
							</Button>
						) ) }
					</Stack>
				) }
			</Stack>
		</Notice>
	);
}

/**
 * Container for rendering dashboard notices.
 * Notices are provided via Dashboard component props and accessed through context.
 *
 * @return Notices container
 */
export default function DashboardNotices() {
	const { notices, onNoticeAction } = useDashboardContext();

	if ( ! notices || notices.length === 0 ) {
		return null;
	}

	return (
		<Stack
			direction="column"
			gap="md"
			className="first-admin-dashboard-notices"
		>
			{ notices.map( ( notice ) => (
				<DashboardNotice
					key={ notice.id }
					id={ notice.id }
					status={ notice.status }
					message={ notice.message }
					actions={ notice.actions }
					onNoticeAction={ onNoticeAction }
				/>
			) ) }
		</Stack>
	);
}
