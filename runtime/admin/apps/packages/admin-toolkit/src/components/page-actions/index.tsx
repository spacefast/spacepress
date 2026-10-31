import { useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';
import { DropdownMenu, Modal } from '@wordpress/components';
import { useRegistry } from '@wordpress/data';
import type { Action, ActionModal, RenderModalProps } from '@zero-admin/dataviews';

export type PageActionConfig< Item > = {
	action: Action< Item >;
	onActionPerformed?: RenderModalProps< Item >[ 'onActionPerformed' ];
};

export function getActionLabel< Item >(
	action: Action< Item >,
	item: Item
): string {
	return typeof action.label === 'string'
		? action.label
		: action.label( [ item ] );
}

function getModalTitle< Item >(
	action: ActionModal< Item >,
	item: Item
): string {
	if ( typeof action.modalHeader === 'function' ) {
		return action.modalHeader( [ item ] );
	}

	if ( typeof action.modalHeader === 'string' ) {
		return action.modalHeader;
	}

	return getActionLabel( action, item );
}

export function PageActions< Item >( {
	actions,
	item,
}: {
	actions: PageActionConfig< Item >[];
	item: Item | null | undefined;
} ) {
	const registry = useRegistry();

	const [ activeModalAction, setActiveModalAction ] =
		useState< ActionModal< Item > | null >( null );

	const controls = useMemo( () => {
		if ( ! item ) {
			return [];
		}

		const allControls = actions
			.filter(
				( { action } ) =>
					action &&
					( ! action.isEligible || action.isEligible( item ) )
			)
			.map( ( { action, onActionPerformed } ) => {
				return {
					id: action.id,
					title: getActionLabel( action, item ),
					onClick: () => {
						if ( 'callback' in action ) {
							void action.callback( [ item ], {
								registry,
								onActionPerformed: ( items: Item[] ) => {
									void onActionPerformed?.( items );
								},
							} );
						} else if ( 'RenderModal' in action ) {
							setActiveModalAction( {
								...action,
								RenderModal: ( props ) => (
									<action.RenderModal
										{ ...props }
										onActionPerformed={ ( items ) => {
											void onActionPerformed?.( items );
										} }
									/>
								),
							} );
						}
					},
				};
			} );
		return allControls;
	}, [ actions, item, registry ] );

	if ( ! item ) {
		return null;
	}

	return (
		<>
			<DropdownMenu
				label={ __( 'Actions', 'zero-admin' ) }
				icon={ moreVertical }
				toggleProps={ { size: 'compact' } }
				controls={ controls }
			/>
			{ activeModalAction && (
				// This configuration is copied-pasted from https://github.com/WordPress/gutenberg/blob/b4c3a8ddff2181bed6cd70590b26ec63fab81799/packages/dataviews/src/components/dataviews-item-actions/index.tsx#L118-L129
				<Modal
					title={ getModalTitle( activeModalAction, item ) }
					onRequestClose={ () => setActiveModalAction( null ) }
					__experimentalHideHeader={
						!! activeModalAction.hideModalHeader
					}
					focusOnMount={ activeModalAction.modalFocusOnMount ?? true }
					size={ activeModalAction.modalSize || 'medium' }
				>
					<activeModalAction.RenderModal
						items={ [ item ] }
						closeModal={ () => setActiveModalAction( null ) }
					/>
				</Modal>
			) }
		</>
	);
}

export default PageActions;
