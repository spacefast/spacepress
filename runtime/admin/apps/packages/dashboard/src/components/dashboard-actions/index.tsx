import { Button, Stack } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';
import { useDashboardContext } from '../dashboard/context';

export type DashboardActionType =
	| 'customize'
	| 'done'
	| 'cancel'
	| 'add-widget';

type DashboardActionsProps = Pick<
	Parameters< typeof Stack >[ 0 ],
	'direction' | 'gap' | 'align' | 'justify'
> & {
	/**
	 * Called when a dashboard action button is clicked, before the
	 * state change. Use for tracking, analytics, or any side effect.
	 */
	onClick?: ( action: DashboardActionType ) => void;
};

const DashboardActions = ( {
	direction = 'row',
	gap = 'sm',
	align = 'center',
	justify = 'right',
	onClick,
}: DashboardActionsProps ) => {
	const {
		editMode,
		hasChanges,
		layout,
		onEdit,
		onCancel,
		onSyncStaging,
		onOpenWidgetsModal,
	} = useDashboardContext();

	const isCommittedLayoutEmpty =
		layout.filter( ( widget ) => ! widget.__meta?.deleted ).length === 0 &&
		! hasChanges;

	if ( isCommittedLayoutEmpty ) {
		return (
			<Stack
				direction={ direction }
				gap={ gap }
				align={ align }
				justify={ justify }
			>
				<Button
					variant="outline"
					size="compact"
					onClick={ () => {
						onClick?.( 'add-widget' );
						onOpenWidgetsModal();
					} }
				>
					{ __( 'Add widgets', 'first-admin' ) }
				</Button>
			</Stack>
		);
	}

	return (
		<Stack
			direction={ direction }
			gap={ gap }
			align={ align }
			justify={ justify }
		>
			{ editMode && (
				<>
					<Button
						variant="minimal"
						size="compact"
						onClick={ () => {
							onClick?.( 'add-widget' );
							onOpenWidgetsModal();
						} }
					>
						{ __( 'Add widget', 'first-admin' ) }
					</Button>
					<Button
						variant="minimal"
						size="compact"
						onClick={ () => {
							onClick?.( 'cancel' );
							onCancel();
						} }
					>
						{ __( 'Cancel', 'first-admin' ) }
					</Button>
				</>
			) }

			<Button
				variant={ editMode ? 'solid' : 'outline' }
				size="compact"
				disabled={ editMode && ! hasChanges }
				onClick={ () => {
					onClick?.( editMode ? 'done' : 'customize' );
					( editMode ? onSyncStaging : onEdit )();
				} }
			>
				{ editMode
					? __( 'Done', 'first-admin' )
					: __( 'Customize', 'first-admin' ) }
			</Button>
		</Stack>
	);
};

export { DashboardActions };
